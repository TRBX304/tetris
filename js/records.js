// ===========================================
// 自分の記録（localStorage）
// ===========================================
const KEY = 'tetrisRecords';

export function getRecords() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export function saveRecord(game) {
    const records = getRecords();
    const key = game.isAIMode ? `${game.mode}_ai` : game.mode;
    if (!records[key]) records[key] = [];

    const record = { mode: game.mode, isAI: game.isAIMode, date: new Date().toISOString() };
    if (game.mode === 'normal') record.score = game.score;
    else if (game.mode === 'sprint1m') record.lines = game.linesCleared;
    else record.time = game.elapsedTime;

    records[key].push(record);
    records[key].sort((a, b) => {
        if (game.mode === 'normal') return b.score - a.score;
        if (game.mode === 'sprint1m') return b.lines - a.lines;
        return a.time - b.time;
    });
    records[key] = records[key].slice(0, 10);
    try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* ignore */ }
}

export function formatTime(ms, withMs = true) {
    const total = ms / 1000;
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    if (!withMs) return `${mm}:${ss}`;
    return `${mm}:${ss}.${String(Math.floor((total % 1) * 1000)).padStart(3, '0')}`;
}

// 記録 → 表示文字列（value: score / lines / time_ms）
export function formatValue(mode, value) {
    if (value === undefined || value === null) return '—';
    if (mode === 'normal') return `${Number(value).toLocaleString()} 点`;
    if (mode === 'sprint1m') return `${value} ライン`;
    return formatTime(value);
}

export function bestValue(mode) {
    const list = getRecords()[mode];
    if (!list || list.length === 0) return null;
    const r = list[0];
    return mode === 'normal' ? r.score : mode === 'sprint1m' ? r.lines : r.time;
}
