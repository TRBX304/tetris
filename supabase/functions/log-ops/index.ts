import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
};

const MAX_OPS_PER_BATCH = 500;
// U=右回転 UL=左回転 D=ハードドロップ K=自然固定 H=ホールド
const VALID_OP_TYPES = new Set(['L', 'R', 'U', 'UL', 'D', 'K', 'LINE', 'SCORE', 'LINES', 'TIME', 'H']);

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const { session_token, ops, seq } = await req.json();

        if (!session_token || !Array.isArray(ops) || typeof seq !== 'number') {
            return Response.json({ error: 'invalid_params' }, { status: 400, headers: CORS });
        }
        if (ops.length === 0) {
            return Response.json({ error: 'empty_ops' }, { status: 400, headers: CORS });
        }
        if (ops.length > MAX_OPS_PER_BATCH) {
            return Response.json({ error: 'too_many_ops' }, { status: 400, headers: CORS });
        }

        // 各操作の基本バリデーション
        for (const op of ops) {
            if (!op || typeof op !== 'object') {
                return Response.json({ error: 'invalid_op_format' }, { status: 400, headers: CORS });
            }
            if (typeof op.t !== 'string' || !VALID_OP_TYPES.has(op.t)) {
                return Response.json({ error: 'invalid_op_type' }, { status: 400, headers: CORS });
            }
            if (op.t === 'LINE' && (typeof op.count !== 'number' || op.count < 1 || op.count > 4)) {
                return Response.json({ error: 'invalid_line_count' }, { status: 400, headers: CORS });
            }
        }

        const { data: session, error: sErr } = await supabase
            .from('sessions')
            .select('id, is_verified')
            .eq('session_token', session_token)
            .single();

        if (sErr || !session) {
            return Response.json({ error: 'invalid_session' }, { status: 404, headers: CORS });
        }
        if (session.is_verified) {
            return Response.json({ ok: true }, { headers: CORS });
        }

        // 同じseqが既に存在する場合は冪等に成功を返す（リトライ対応）
        const { data: existing } = await supabase
            .from('operation_logs')
            .select('id')
            .eq('session_token', session_token)
            .eq('seq', seq)
            .single();

        if (existing) {
            return Response.json({ ok: true, duplicate: true }, { headers: CORS });
        }

        const { error: iErr } = await supabase
            .from('operation_logs')
            .insert({ session_token, ops, seq });

        if (iErr) throw iErr;

        return Response.json({ ok: true }, { headers: CORS });
    } catch (e) {
        return Response.json({ error: String(e) }, { status: 500, headers: CORS });
    }
});