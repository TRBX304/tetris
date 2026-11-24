import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
};

// =============================================
// テトリスのゲームルール定数
// =============================================
const SCORE_TABLE: Record<number, number> = { 1: 25, 2: 100, 3: 400, 4: 1600 };

// =============================================
// シード付き乱数（クライアントと完全一致）
// =============================================
class SeededRandom {
    private s: number;
    constructor(seed: number) { this.s = (seed >>> 0) || 1; }
    next(): number {
        this.s ^= this.s << 13;
        this.s ^= this.s >>> 17;
        this.s ^= this.s << 5;
        return (this.s >>> 0) / 0xFFFFFFFF;
    }
}

// =============================================
// ピース列の再現（7-bag）
// =============================================
function generatePieceSequence(seed: number, count: number): string[] {
    const rng = new SeededRandom(seed);
    const types = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
    const sequence: string[] = [];
    let bag: string[] = [];

    for (let i = 0; i < count; i++) {
        if (bag.length === 0) {
            bag = [...types];
            for (let j = bag.length - 1; j > 0; j--) {
                const k = Math.floor(rng.next() * (j + 1));
                [bag[j], bag[k]] = [bag[k], bag[j]];
            }
        }
        sequence.push(bag.shift()!);
    }
    return sequence;
}

// =============================================
// 統計チェック（強化版: サーバー時刻併用）
// =============================================
function statisticalCheck(
    ops: any[], mode: string,
    clientElapsedMs: number, serverElapsedMs: number
) {
    const MIN_TIMES: Record<string, number> = {
        'time10': 8000, 'time20': 15000, 'time40': 25000,
        'time100': 60000, 'sprint1m': 5000, 'normal': 5000,
    };
    const minTime = MIN_TIMES[mode] ?? 5000;

    // サーバー時刻ベース
    // session-startのネットワーク遅延でcreated_atがゲーム開始より遅れることがあるため、
    // サーバー時刻チェックはリジェクトではなくフラグにとどめる
    let flagged = false;
    if (serverElapsedMs < minTime * 0.5) {
        // サーバー経過が最低時間の半分未満 → さすがに怪しい
        return { ok: false, flagged: false, reason: 'too_fast_server' };
    }

    // クライアント時刻ベース（こちらがメイン判定）
    if (clientElapsedMs < minTime) {
        return { ok: false, flagged: false, reason: 'too_fast' };
    }

    // 操作レート（秒間20操作まで）
    if (ops.length > (clientElapsedMs / 1000) * 20) {
        return { ok: false, flagged: false, reason: 'input_rate_exceeded' };
    }

    return { ok: true, flagged };
}

// =============================================
// 操作ログ整合性チェック
// =============================================
// U=右回転 UL=左回転 D=ハードドロップ K=自然固定（ロックディレイ切れ） H=ホールド
const VALID_OP_TYPES = new Set(['L', 'R', 'U', 'UL', 'D', 'K', 'LINE', 'SCORE', 'LINES', 'TIME', 'H']);

// ミノが固定された回数として数える操作（ハードドロップ + 自然固定）
const isLockOp = (o: any) => o.t === 'D' || o.t === 'K';

function validateOpsIntegrity(ops: any[]): { ok: boolean; reason?: string } {
    // 不明な操作タイプ
    for (const op of ops) {
        if (!op || typeof op.t !== 'string' || !VALID_OP_TYPES.has(op.t)) {
            return { ok: false, reason: 'invalid_op_type' };
        }
    }

    // タイムスタンプ単調増加（100ms余裕）
    const timestamps = ops.map(o => o.ts).filter(t => typeof t === 'number');
    for (let i = 1; i < timestamps.length; i++) {
        if (timestamps[i] < timestamps[i - 1] - 100) {
            return { ok: false, reason: 'timestamp_rewind' };
        }
    }

    // LINE.count は 1〜4 の整数のみ
    for (const op of ops) {
        if (op.t === 'LINE') {
            if (typeof op.count !== 'number' || op.count < 1 || op.count > 4 || !Number.isInteger(op.count)) {
                return { ok: false, reason: 'invalid_line_count' };
            }
        }
    }

    // SCORE は非負有限数
    for (const op of ops) {
        if (op.t === 'SCORE') {
            if (typeof op.score !== 'number' || op.score < 0 || !Number.isFinite(op.score)) {
                return { ok: false, reason: 'invalid_score_value' };
            }
        }
    }

    // LINES は非負整数
    for (const op of ops) {
        if (op.t === 'LINES') {
            if (typeof op.lines !== 'number' || op.lines < 0 || !Number.isInteger(op.lines)) {
                return { ok: false, reason: 'invalid_lines_value' };
            }
        }
    }

    // LINE は固定（D または K）の後にしか出現できない
    let dropSeen = false;
    for (const op of ops) {
        if (isLockOp(op)) dropSeen = true;
        if (op.t === 'LINE' && !dropSeen) {
            return { ok: false, reason: 'line_before_drop' };
        }
    }

    return { ok: true };
}

// =============================================
// ドロップ数 vs ライン数の物理制約
// =============================================
function validateLinesByDrops(ops: any[]): { ok: boolean; flagged: boolean; reason?: string } {
    const dropCount = ops.filter(isLockOp).length;
    const totalLines = ops
        .filter(o => o.t === 'LINE')
        .reduce((acc, o) => acc + (o.count ?? 0), 0);

    // 理論上限: 1ドロップ = 最大4ライン
    if (totalLines > dropCount * 4) {
        return { ok: false, flagged: false, reason: 'lines_exceed_drops' };
    }

    // 異常に高効率 → フラグ
    if (dropCount > 0 && totalLines / dropCount > 3) {
        return { ok: true, flagged: true };
    }

    return { ok: true, flagged: false };
}

// =============================================
// LINE と LINES のクロスチェック
// =============================================
function crossCheckLines(ops: any[]): { ok: boolean; reason?: string } {
    const lineSum = ops
        .filter(o => o.t === 'LINE')
        .reduce((acc, o) => acc + (o.count ?? 0), 0);

    const linesOp = [...ops].reverse().find(o => o.t === 'LINES');
    if (linesOp && (linesOp.lines ?? 0) !== lineSum) {
        return { ok: false, reason: 'lines_mismatch' };
    }

    return { ok: true };
}

// =============================================
// サーバー側スコア上限計算（normalモード）
//
// 操作ログ内の LINE イベントから、
// 各消去で理論上ありえる最大スコアを積み上げる。
// Tスピン・パーフェクトクリア・BtBの全てが
// 毎回発生した場合の天井値なので、
// 正当なプレイは必ずこれ以下に収まる。
// =============================================
function computeScoreCeiling(ops: any[]): number {
    const lineOps = ops.filter(o => o.t === 'LINE');

    let ceiling = 0;
    let cumulativeLines = 0;

    for (const lo of lineOps) {
        const count: number = lo.count ?? 0;
        cumulativeLines += count;
        const lv = Math.floor(cumulativeLines / 10) + 1;

        // 基本ラインスコア
        ceiling += (SCORE_TABLE[count] || 25) * (lv + 1);

        // Tスピンボーナス（全消去がTスピンだったと仮定）
        ceiling += count * 400 * lv;

        // パーフェクトクリアボーナス（毎回全消しだったと仮定）
        ceiling += 3000 * lv;

        // BtBボーナス余裕
        ceiling += 800 * lv;
    }

    // 安全マージン 20%
    return Math.ceil(ceiling * 1.2);
}

// =============================================
// seq 連続性チェック
// =============================================
function validateSeqContinuity(logRows: any[]): boolean {
    if (!logRows || logRows.length === 0) return true;
    const seqs = logRows.map((r: any) => r.seq).sort((a: number, b: number) => a - b);
    for (let i = 0; i < seqs.length; i++) {
        if (seqs[i] !== i) return false;
    }
    return true;
}

// =============================================
// レートリミット（楽観的ロック版）
// =============================================
async function checkRateLimit(supabase: any, ipHash: string): Promise<boolean> {
    const WINDOW_MS = 60 * 60 * 1000;
    const MAX_SUBMITS = 10;

    const { data } = await supabase
        .from('rate_limits').select('*')
        .eq('ip_hash', ipHash).single();
    const now = new Date();

    if (!data) {
        await supabase.from('rate_limits').insert({
            ip_hash: ipHash, submit_count: 1, window_start: now
        });
        return true;
    }

    if (now.getTime() - new Date(data.window_start).getTime() > WINDOW_MS) {
        await supabase.from('rate_limits')
            .update({ submit_count: 1, window_start: now })
            .eq('ip_hash', ipHash);
        return true;
    }

    if (data.submit_count >= MAX_SUBMITS) return false;

    // 楽観的ロック: 既知の値が変わっていなければ更新
    const { error } = await supabase.from('rate_limits')
        .update({ submit_count: data.submit_count + 1 })
        .eq('ip_hash', ipHash)
        .eq('submit_count', data.submit_count);

    // 競合 → 安全側に倒す
    return !error;
}

// =============================================
// ヘルパー
// =============================================
async function markVerified(supabase: any, token: string) {
    await supabase.from('sessions')
        .update({ is_verified: true })
        .eq('session_token', token);
}

// =============================================
// メインハンドラ
// =============================================
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const { session_token, player_name } = await req.json();

        if (!session_token || !player_name?.trim()) {
            return Response.json({ error: 'invalid_params' }, { status: 400, headers: CORS });
        }

        // ── セッション検証 ──
        const { data: session, error: sErr } = await supabase
            .from('sessions').select('*')
            .eq('session_token', session_token).single();

        if (sErr || !session) {
            return Response.json({ ok: false, error: 'invalid_session' }, { headers: CORS });
        }
        if (session.is_verified) {
            return Response.json({ ok: false, error: 'already_saved' }, { headers: CORS });
        }

        // ── レートリミット ──
        const allowed = await checkRateLimit(supabase, session.ip_hash);
        if (!allowed) {
            return Response.json({ ok: false, error: 'rate_limited' }, { headers: CORS });
        }

        // ── 操作ログ取得 ──
        const { data: logRows } = await supabase
            .from('operation_logs').select('ops, seq')
            .eq('session_token', session_token)
            .order('seq', { ascending: true });

        // seq 連続性
        if (!validateSeqContinuity(logRows)) {
            console.warn(`[REJECT] seq_gap | session=${session_token} | mode=${session.mode}`);
            await markVerified(supabase, session_token);
            return fail(CORS, 'verify_failed');
        }

        const allOps: any[] = (logRows ?? []).flatMap((r: any) => r.ops);

        // ── 最低操作数 ──
        if (allOps.length < 3) {
            console.warn(`[REJECT] insufficient_ops | ops=${allOps.length} | session=${session_token}`);
            await markVerified(supabase, session_token);
            return fail(CORS, 'verify_failed');
        }

        // ── 操作ログ整合性 ──
        const integrity = validateOpsIntegrity(allOps);
        if (!integrity.ok) {
            console.warn(`[REJECT] integrity | reason=${integrity.reason} | session=${session_token}`);
            await markVerified(supabase, session_token);
            return fail(CORS, 'verify_failed');
        }

        // ── 時間計算 ──
        const timestamps = allOps.map(o => o.ts).filter(t => typeof t === 'number');
        const clientElapsedMs = timestamps.length >= 2
            ? timestamps[timestamps.length - 1] - timestamps[0] : 0;

        const serverElapsedMs = Date.now() - new Date(session.created_at).getTime();

        console.log(`[TIME] mode=${session.mode} | client=${clientElapsedMs}ms | server=${serverElapsedMs}ms | ops=${allOps.length}`);

        // クライアント経過がサーバー経過の3倍+10秒を超えたら改ざん
        // （スマホのネットワーク遅延やsession-startの応答遅延を考慮して余裕を持たせる）
        if (clientElapsedMs > serverElapsedMs * 3 + 10000) {
            console.warn(`[REJECT] time_discrepancy | client=${clientElapsedMs} > server=${serverElapsedMs}*3+10000`);
            await markVerified(supabase, session_token);
            return fail(CORS, 'verify_failed');
        }

        // ── 統計チェック ──
        const stat = statisticalCheck(allOps, session.mode, clientElapsedMs, serverElapsedMs);
        if (!stat.ok) {
            console.warn(`[REJECT] statistical | reason=${stat.reason} | client=${clientElapsedMs}ms | server=${serverElapsedMs}ms | ops=${allOps.length}`);
            await markVerified(supabase, session_token);
            return fail(CORS, 'verify_failed');
        }

        // ── ドロップ/ライン物理制約 ──
        const dropLine = validateLinesByDrops(allOps);
        if (!dropLine.ok) {
            const drops = allOps.filter(isLockOp).length;
            const lines = allOps.filter((o:any) => o.t === 'LINE').reduce((a:number,o:any)=>a+(o.count??0),0);
            console.warn(`[REJECT] drop_line | reason=${dropLine.reason} | drops=${drops} | lines=${lines}`);
            await markVerified(supabase, session_token);
            return fail(CORS, 'verify_failed');
        }

        // ── LINE/LINES クロスチェック ──
        const cross = crossCheckLines(allOps);
        if (!cross.ok) {
            const lineSum = allOps.filter((o:any)=>o.t==='LINE').reduce((a:number,o:any)=>a+(o.count??0),0);
            const linesOp = [...allOps].reverse().find((o:any)=>o.t==='LINES');
            console.warn(`[REJECT] lines_mismatch | LINE合計=${lineSum} | LINES申告=${linesOp?.lines}`);
            await markVerified(supabase, session_token);
            return fail(CORS, 'verify_failed');
        }

        // ── フラグ集計 ──
        let isFlagged = stat.flagged || dropLine.flagged;

        // ── モード別スコア計算・検証 ──
        const scoreRow: Record<string, any> = {
            session_token,
            player_name: player_name.trim().slice(0, 16),
            mode: session.mode,
            region: req.headers.get('cf-ipcountry') || 'UNKNOWN',
            is_flagged: isFlagged,
        };

        if (session.mode === 'normal') {
            const scoreOp = [...allOps].reverse().find(o => o.t === 'SCORE');
            const claimedScore = scoreOp?.score ?? 0;

            // サーバー算出スコア上限
            const ceiling = computeScoreCeiling(allOps);
            if (claimedScore > ceiling) {
                console.warn(`[REJECT] score_exceeds_ceiling | claimed=${claimedScore} | ceiling=${ceiling}`);
                await markVerified(supabase, session_token);
                return fail(CORS, 'verify_failed');
            }

            // ドロップあたり平均が異常 → フラグ
            const dropCount = allOps.filter(isLockOp).length;
            if (dropCount > 0 && claimedScore / dropCount > 3000) {
                isFlagged = true;
            }

            scoreRow.score = claimedScore;
            scoreRow.is_flagged = isFlagged;

        } else if (session.mode === 'sprint1m') {
            // LINE イベントの合計を正とする（LINES 自己申告は信用しない）
            const lineSum = allOps
                .filter(o => o.t === 'LINE')
                .reduce((acc, o) => acc + (o.count ?? 0), 0);

            scoreRow.lines = lineSum;

            // サーバー経過40秒未満 → フラグ（sprint は60秒のはず、session-start遅延を考慮）
            if (serverElapsedMs < 40000) isFlagged = true;

            scoreRow.is_flagged = isFlagged;

        } else {
            // タイムアタック・sprint1m共通
            // TIMEイベント（クライアントのelapsedTime）を優先して使う
            const timeOp = [...allOps].reverse().find((o: any) => o.t === 'TIME');
            const clientTimerMs = timeOp?.time_ms ?? clientElapsedMs;

            // opLogのts差 vs クライアントタイマーのクロスチェック
            // 正当プレイではclientTimerMs >= clientElapsedMs（タイマーは最初の操作より前に開始）
            // clientTimerMsが操作ログのts差より大幅に短い場合はtime_ms改ざんとみなしreject
            if (clientElapsedMs > 0 && clientTimerMs < clientElapsedMs * 0.7) {
                console.warn(`[REJECT] timer_ops_mismatch | timer=${clientTimerMs}ms | ops_span=${clientElapsedMs}ms | mode=${session.mode}`);
                await markVerified(supabase, session_token);
                return fail(CORS, 'verify_failed');
            }

            // クライアントタイマーがサーバー経過の20%未満 → フラグ
            if (clientTimerMs < serverElapsedMs * 0.2) isFlagged = true;

            scoreRow.time_ms = clientTimerMs;
            scoreRow.is_flagged = isFlagged;
        }

        // ── DB保存 ──
        const { error: iErr } = await supabase.from('scores').insert(scoreRow);
        if (iErr) throw iErr;

        await supabase.from('sessions')
            .update({ is_verified: true, finished_at: new Date() })
            .eq('session_token', session_token);

        console.log(`[OK] mode=${session.mode} | player=${player_name} | flagged=${isFlagged} | score=${JSON.stringify({score:scoreRow.score, lines:scoreRow.lines, time_ms:scoreRow.time_ms})}`);
        return Response.json({ ok: true, is_flagged: isFlagged, ...scoreRow }, { headers: CORS });

    } catch (e) {
        return Response.json({ error: String(e) }, { status: 500, headers: CORS });
    }
});

function fail(cors: Record<string, string>, _reason: string) {
    // _reason はサーバーログ（console.warn）にのみ記録済み。
    // クライアントには汎用メッセージだけ返す。
    return Response.json(
        { ok: false, error: 'verify_failed' },
        { headers: cors }
    );
}