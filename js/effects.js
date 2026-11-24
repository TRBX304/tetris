// ===========================================
// 演出（画面揺れ・パーティクル・残像・ポップアップ文字）
// 1つの TetrisGame に1つ。描画は game.draw() の最後で呼ばれる
// ===========================================
import { settings } from './settings.js';

const SHAKE_STRENGTH = 1;   // 揺れの強さ（デモで決めた値）

function easeOutBack(x) {
    const c1 = 1.7, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export class Effects {
    constructor(game, { popupEl = null } = {}) {
        this.game = game;
        this.popupEl = popupEl;
        this.particles = [];
        this.trails = [];
        this.lockFlashes = [];
        this.shake = { a: 0, t: 0 };
        this.bump = { a: 0, t: 0 };
        this.fall = null;           // ライン消去後に上の段が落ちるアニメ
        this.flashAll = 0;          // 盤面全体の白フラッシュ
        this.lastNow = performance.now();
        this.popupTimer = null;
    }

    get reduced() { return settings.reducedMotion; }
    get scale() { return this.game.blockSize / 20; }

    // ---------- イベント ----------

    hardDrop(piece, fromY, toY) {
        const now = performance.now();
        const cols = {};
        for (const c of piece.cells()) {
            if (cols[c.x] === undefined || c.y < cols[c.x]) cols[c.x] = c.y;
        }
        const dist = toY - fromY;
        if (dist > 0) {
            for (const [x, topY] of Object.entries(cols)) {
                this.trails.push({ x: +x, y0: topY - dist, y1: topY, color: piece.color, t: now });
            }
        }
        // 着地した場所に砂ぼこり
        const bottoms = {};
        for (const c of piece.cells()) {
            if (bottoms[c.x] === undefined || c.y > bottoms[c.x]) bottoms[c.x] = c.y;
        }
        const n = this.reduced ? 1 : 3;
        for (const [x, y] of Object.entries(bottoms)) {
            for (let i = 0; i < n; i++) {
                this.particles.push(this._particle(+x + 0.5, y + 1, '#c9d1ff', 0.6, 0.35));
            }
        }
        if (!this.reduced) this.bump = { a: 3 * this.scale * SHAKE_STRENGTH, t: now };
    }

    lock(cells) {
        this.lockFlashes.push({ cells, t: performance.now() });
    }

    // rows: [{ y, colors: [...] }]  shifts: 新しいボードの各行が何段落ちたか
    lineClear({ rows, shifts, count, tspin, perfect }) {
        const now = performance.now();
        const perCell = this.reduced ? 1 : (perfect ? 5 : 3);
        for (const row of rows) {
            row.colors.forEach((color, x) => {
                if (!color) return;
                if (this.reduced && x % 2) return;
                for (let i = 0; i < perCell; i++) {
                    this.particles.push(this._particle(x + 0.5, row.y + 0.5, color, 1, 1));
                }
            });
        }
        if (!this.reduced) {
            const a = SHAKE_STRENGTH * (1.5 + count * 1.2) * (tspin ? 1.4 : 1) * (perfect ? 1.6 : 1);
            this.shake = { a: a * this.scale, t: now };
            if (count === 4 || tspin || perfect) this.flashAll = perfect ? 1.6 : 1;
        }
        this.fall = { shifts, t: now, dur: this.reduced ? 120 : 220 };
    }

    // 盤面の上に大きな文字（kind: tetris / tspin / pc / ren / normal）
    popText(text, kind = 'normal') {
        if (!this.popupEl) return;
        const el = this.popupEl;
        el.textContent = text;
        el.className = `board-popup show kind-${kind}`;
        void el.offsetWidth;                 // アニメーションを最初から再生
        el.classList.add('anim');
        clearTimeout(this.popupTimer);
        this.popupTimer = setTimeout(() => { el.className = 'board-popup'; }, 1100);
    }

    clear() {
        this.particles = [];
        this.trails = [];
        this.lockFlashes = [];
        this.fall = null;
        this.flashAll = 0;
        this.shake.a = 0;
        this.bump.a = 0;
        this.game.canvas.style.transform = '';
        if (this.popupEl) this.popupEl.className = 'board-popup';
    }

    // ---------- 描画まわり ----------

    // ライン消去後、上の段を何px上に描くか（落ちてくるアニメ）
    rowOffset(boardY) {
        const f = this.fall;
        if (!f) return 0;
        const shift = f.shifts[boardY] || 0;
        if (!shift) return 0;
        const p = Math.min(1, (performance.now() - f.t) / f.dur);
        if (p >= 1) return 0;
        return shift * this.game.blockSize * (1 - easeOutBack(p));
    }

    draw(ctx) {
        const now = performance.now();
        const dt = Math.min(50, now - this.lastNow);
        this.lastNow = now;
        const bs = this.game.blockSize;
        const W = this.game.canvas.width / this.game.dpr;
        const H = this.game.canvas.height / this.game.dpr;

        if (this.fall && now - this.fall.t > this.fall.dur) this.fall = null;

        // ハードドロップの残像
        this.trails = this.trails.filter(t => now - t.t < 160);
        for (const t of this.trails) {
            const k = 1 - (now - t.t) / 160;
            const top = Math.max(0, t.y0) * bs;
            const bottom = t.y1 * bs;
            if (bottom <= top) continue;
            const g = ctx.createLinearGradient(0, top, 0, bottom);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(1, hexAlpha(t.color, 0.45 * k));
            ctx.fillStyle = g;
            ctx.fillRect(t.x * bs + bs * 0.15, top, bs * 0.7, bottom - top);
        }

        // 固定した瞬間に少し光る
        this.lockFlashes = this.lockFlashes.filter(f => now - f.t < 140);
        for (const f of this.lockFlashes) {
            ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - (now - f.t) / 140)})`;
            for (const c of f.cells) {
                if (c.y >= 0) ctx.fillRect(c.x * bs, c.y * bs, bs, bs);
            }
        }

        // パーティクル
        const step = dt / 16.67;
        this.particles = this.particles.filter(p => p.life > 0);
        for (const p of this.particles) {
            p.x += p.vx * step;
            p.y += p.vy * step;
            p.vy += 0.25 * step * p.g;
            p.life -= 0.022 * step;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            const s = p.size * this.scale;
            ctx.fillRect(p.x * bs - s / 2, p.y * bs - s / 2, s, s);
        }
        ctx.globalAlpha = 1;

        // 盤面全体のフラッシュ
        if (this.flashAll > 0) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(1, this.flashAll) * 0.22})`;
            ctx.fillRect(0, 0, W, H);
            this.flashAll = Math.max(0, this.flashAll - 0.06 * step);
        }

        // 画面揺れ（キャンバス要素ごと動かす）
        let sx = 0, sy = 0;
        if (this.shake.a > 0) {
            const k = Math.max(0, 1 - (now - this.shake.t) / 320);
            const a = this.shake.a * k * k;
            sx += (Math.random() - 0.5) * 2 * a;
            sy += (Math.random() - 0.5) * 2 * a;
            if (k === 0) this.shake.a = 0;
        }
        if (this.bump.a > 0) {
            const k = Math.max(0, 1 - (now - this.bump.t) / 140);
            sy += this.bump.a * Math.sin(k * Math.PI) * k;
            if (k === 0) this.bump.a = 0;
        }
        this.game.canvas.style.transform = (sx || sy) ? `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)` : '';
    }

    // x, y はマス単位
    _particle(x, y, color, speed, sizeMul) {
        return {
            x, y,
            vx: (Math.random() - 0.5) * 0.25 * speed,
            vy: (-Math.random() * 0.25 - 0.05) * speed,
            g: 0.05,
            color,
            life: 1,
            size: (4 + Math.random() * 4) * sizeMul
        };
    }
}

function hexAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
