// ===========================================
// ユーザー設定（localStorageに保存）
// ===========================================
const KEY = 'tetrisSettings';

const prefersReduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULTS = {
    control: 'button',          // 'button' | 'swipe'（スマホのみ）
    reducedMotion: prefersReduced,
    sfx: true,
    bgm: true
};

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

export const settings = load();

const listeners = [];
export function onSettingsChange(fn) { listeners.push(fn); }

export function setSetting(key, value) {
    settings[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    listeners.forEach(fn => fn(key, value));
}

// タッチ操作の端末か（ボタン操作パッドを出すかどうか）
export function isTouchDevice() {
    return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
        || 'ontouchstart' in window;
}
