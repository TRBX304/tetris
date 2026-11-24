// ===========================================
// 入力: キーボード / ボタンパッド / スワイプ
// 押しっぱなしの連続移動（DAS/ARR）もここで処理
// ===========================================
import { DAS_MS, ARR_MS, SOFT_DROP_MS } from './config.js';
import { settings } from './settings.js';

// 押しっぱなしで繰り返す操作
const REPEAT = {
    left: { das: DAS_MS, arr: ARR_MS },
    right: { das: DAS_MS, arr: ARR_MS },
    soft: { das: SOFT_DROP_MS, arr: SOFT_DROP_MS }
};

const KEYMAP = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'soft',
    ArrowUp: 'cw',
    x: 'cw', X: 'cw',
    z: 'ccw', Z: 'ccw',
    Control: 'ccw',
    ' ': 'hard',
    c: 'hold', C: 'hold', Shift: 'hold',
    p: 'pause', P: 'pause', Escape: 'pause',
    Backspace: 'undo'
};

/**
 * @param {() => object|null} getGame 操作対象の TetrisGame（なければ null）
 * @param {{ pause: () => void }} actions
 */
export function setupInput(getGame, actions) {
    const held = {};

    function run(action) {
        const g = getGame();
        if (!g) return;
        switch (action) {
            case 'left': g.moveLeft(); break;
            case 'right': g.moveRight(); break;
            case 'soft': g.moveDown(true); break;
            case 'cw': g.rotate(1); break;
            case 'ccw': g.rotate(-1); break;
            case 'hard': g.hardDrop(); break;
            case 'hold': g.hold(); break;
            case 'undo': g.undo && g.undo(); break;
        }
    }

    function press(action) {
        if (action === 'pause') { actions.pause(); return; }
        if (held[action]) return;
        // 左右は後から押したほうを優先
        if (action === 'left') release('right');
        if (action === 'right') release('left');
        run(action);
        const r = REPEAT[action];
        if (r) {
            held[action] = { timeout: setTimeout(() => {
                held[action].interval = setInterval(() => run(action), r.arr);
            }, r.das) };
        } else {
            held[action] = {};
        }
    }

    function release(action) {
        const h = held[action];
        if (!h) return;
        clearTimeout(h.timeout);
        clearInterval(h.interval);
        delete held[action];
    }

    function releaseAll() {
        Object.keys(held).forEach(release);
    }

    // ---- キーボード ----
    document.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        const action = KEYMAP[e.key];
        if (!action) return;
        if (!getGame() && action !== 'pause') return;
        e.preventDefault();
        if (e.repeat) return;   // OSのキーリピートは使わない（自前のDAS/ARRを使う）
        press(action);
    });
    document.addEventListener('keyup', (e) => {
        const action = KEYMAP[e.key];
        if (action) release(action);
    });
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

    // ---- ボタン（data-action を持つ要素） ----
    document.querySelectorAll('[data-action]').forEach((btn) => {
        const action = btn.dataset.action;
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            btn.setPointerCapture?.(e.pointerId);
            btn.classList.add('pressed');
            press(action);
        });
        const up = () => {
            btn.classList.remove('pressed');
            release(action);
        };
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // ---- スワイプ（設定でスワイプを選んだときだけ） ----
    const board = document.getElementById('boardWrap');
    let sx = 0, sy = 0, st = 0;
    board.addEventListener('touchstart', (e) => {
        if (settings.control !== 'swipe' || !getGame()) return;
        e.preventDefault();
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; st = Date.now();
    }, { passive: false });
    board.addEventListener('touchmove', (e) => {
        if (settings.control === 'swipe') e.preventDefault();
    }, { passive: false });
    board.addEventListener('touchend', (e) => {
        if (settings.control !== 'swipe' || !getGame()) return;
        e.preventDefault();
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        const ax = Math.abs(dx), ay = Math.abs(dy);
        const MIN = 30;
        if (ax < MIN && ay < MIN && Date.now() - st < 220) {
            // タップ: 盤面の左半分なら左回転、右半分なら右回転
            const rect = board.getBoundingClientRect();
            run(t.clientX < rect.left + rect.width / 2 ? 'ccw' : 'cw');
            return;
        }
        if (ax > ay) {
            // 長いスワイプはその分だけ移動
            const steps = Math.max(1, Math.round(ax / 40));
            for (let i = 0; i < steps; i++) run(dx < 0 ? 'left' : 'right');
        } else if (dy < 0) {
            run('hard');
        } else {
            const steps = Math.max(1, Math.round(ay / 30));
            for (let i = 0; i < steps; i++) run('soft');
        }
    }, { passive: false });

    return { releaseAll };
}
