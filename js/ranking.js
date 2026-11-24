// ===========================================
// 世界ランキング: セッション・操作ログ・取得
// ===========================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const FN = `${SUPABASE_URL}/functions/v1`;
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
};

// 1プレイ分のセッション。操作ログをバッファして2秒ごとに送る
export class RankingSession {
    constructor(seed, mode) {
        this.seed = seed;
        this.mode = mode;
        this.token = null;
        this.opLog = [];
        this.seq = 0;
        this.flushing = false;
        this.timer = null;
    }

    async start() {
        this.timer = setInterval(() => this.flush(), 2000);
        try {
            const res = await fetch(`${FN}/session-start`, {
                method: 'POST', headers: HEADERS,
                body: JSON.stringify({ seed: this.seed, mode: this.mode })
            });
            const data = await res.json();
            this.token = data.session_token || null;
        } catch (e) {
            console.warn('session-start failed (offline?)', e);
        }
    }

    // 操作の種類: L R U(右回転) UL(左回転) D(ハードドロップ) K(自然固定) H(ホールド)
    //            LINE SCORE LINES TIME
    log(type, payload = {}) {
        this.opLog.push({ t: type, ts: performance.now() | 0, ...payload });
    }

    async flush() {
        if (this.flushing || !this.token || this.opLog.length === 0) return;
        this.flushing = true;
        // 1バッチ500件まで（サーバー側の上限）
        const batch = this.opLog.splice(0, 500);
        const seq = this.seq;
        try {
            const res = await fetch(`${FN}/log-ops`, {
                method: 'POST', headers: HEADERS,
                body: JSON.stringify({ session_token: this.token, ops: batch, seq })
            });
            if (res.ok) this.seq++;
            else this.opLog.unshift(...batch);
        } catch {
            this.opLog.unshift(...batch);
        } finally {
            this.flushing = false;
        }
    }

    async flushAll() {
        for (let attempt = 0; attempt < 5; attempt++) {
            while (this.opLog.length > 0) {
                const before = this.opLog.length;
                await this.flush();
                if (this.opLog.length >= before) {
                    await new Promise(r => setTimeout(r, 1000));
                    break;
                }
            }
            if (this.opLog.length === 0) return true;
        }
        return false;
    }

    async verifyAndSave(playerName) {
        const flushed = await this.flushAll();
        if (!flushed) return { ok: false, error: 'flush_failed' };
        try {
            const res = await fetch(`${FN}/verify-and-save`, {
                method: 'POST', headers: HEADERS,
                body: JSON.stringify({ session_token: this.token, player_name: playerName })
            });
            return await res.json();
        } catch {
            return { ok: false, error: 'network' };
        }
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

// 世界ランキング取得（30秒キャッシュ）
const cache = {};
export function clearRankingCache() {
    for (const k of Object.keys(cache)) delete cache[k];
}

export async function fetchWorldRanking(mode, period) {
    const key = `${mode}_${period}`;
    const c = cache[key];
    if (c && Date.now() - c.at < 30000) return c.data;
    const params = new URLSearchParams({ mode, period, limit: 100 });
    const res = await fetch(`${FN}/get-ranking?${params}`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('bad response');
    cache[key] = { data, at: Date.now() };
    return data;
}
