// ===========================================
// AI対戦モード
// ===========================================
import { BOARD_WIDTH, BOARD_HEIGHT, BUFFER_HEIGHT, TOTAL_HEIGHT } from './config.js';
import { TetrisGame } from './game.js';
import { soundManager, bgmManager } from './audio.js';

const AI_SPEEDS = { easy: 1000, normal: 500, hard: 200, expert: 100, master: 50, inferno: 10 };
export const DIFFICULTY_LABELS = {
    easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert', master: 'Master', inferno: 'Inferno'
};

export class BattleManager {
    /**
     * @param {object} ui  { blockSizeFn, popupEl, onEnd(title, kind), onPause(paused), onStats(pg, ag) }
     */
    constructor(difficulty = 'normal', aiVsAi = false, ui = {}) {
        this.difficulty = difficulty;
        this.aiVsAi = aiVsAi;
        this.ui = ui;
        this.playerGame = null;
        this.aiGame = null;
        this.isRunning = false;
        this.isPaused = false;
        this.animationFrameId = null;
        this.lastUpdateTime = 0;
        this.isMobile = window.innerWidth <= 768;
    }

    start() {
        this.playerGame = new TetrisGame('battle', this.aiVsAi, {
            isBattle: true,
            canvasId: 'gameCanvas',
            nextCanvasId: 'nextCanvas',
            holdCanvasId: 'holdCanvas',
            blockSizeFn: this.ui.blockSizeFn,
            popupEl: this.ui.popupEl,
            onGameOver: () => this.handleGameEnd(),
            onGarbageSend: (lines) => this.aiGame.receiveGarbage(lines)
        });

        this.aiGame = new TetrisGame('battle', true, {
            isBattle: true,
            canvasId: 'aiCanvas',
            nextCanvasId: 'aiNextCanvas',
            holdCanvasId: null,
            blockSize: this.isMobile ? 10 : 16,
            onGameOver: () => this.handleGameEnd(),
            onGarbageSend: (lines) => this.playerGame.receiveGarbage(lines)
        });

        // 数字が大きいほど遅い＝弱い。AI観戦モードではプレイヤー側(AI1)は50ms固定
        if (this.aiVsAi) this.playerGame.aiMoveInterval = 50;
        this.aiGame.aiMoveInterval = AI_SPEEDS[this.difficulty];

        // スマホ: AIの盤面はプレイヤー盤面に影として重ねる
        if (this.isMobile) {
            this.playerGame.onAfterBackgroundDraw = (ctx, bs) => this.drawAIShadow(ctx, bs);
        }

        this.isRunning = true;
        this.lastUpdateTime = performance.now();
        this.gameLoop();
    }

    drawAIShadow(ctx, bs) {
        const board = this.aiGame.board;
        ctx.fillStyle = 'rgba(255, 110, 110, 0.13)';
        for (let by = BUFFER_HEIGHT; by < TOTAL_HEIGHT; by++) {
            for (let x = 0; x < BOARD_WIDTH; x++) {
                if (board[by][x] !== null) ctx.fillRect(x * bs, (by - BUFFER_HEIGHT) * bs, bs, bs);
            }
        }
        const p = this.aiGame.currentPiece;
        if (p) {
            ctx.fillStyle = 'rgba(255, 110, 110, 0.22)';
            for (const c of p.cells()) if (c.y >= 0) ctx.fillRect(c.x * bs, c.y * bs, bs, bs);
        }
    }

    gameLoop() {
        if (!this.isRunning) return;
        const now = performance.now();
        const dt = Math.min(100, now - this.lastUpdateTime);
        this.lastUpdateTime = now;
        if (!this.isPaused) {
            this.playerGame.update(dt);
            this.aiGame.update(dt);
        }
        this.playerGame.draw();
        this.aiGame.draw();
        this.updateDisplay();
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    updateDisplay() {
        if (this.ui.onStats) this.ui.onStats(this.playerGame, this.aiGame);
        const bar = document.getElementById('aiGaugeBar');
        const lines = document.getElementById('aiGaugeLines');
        if (bar && lines) {
            bar.style.height = `${(this.getStackHeight(this.aiGame) / BOARD_HEIGHT) * 100}%`;
            lines.textContent = this.aiGame.linesCleared;
        }
    }

    getStackHeight(game) {
        for (let y = BUFFER_HEIGHT; y < TOTAL_HEIGHT; y++) {
            if (game.board[y].some(c => c !== null)) return TOTAL_HEIGHT - y;
        }
        return 0;
    }

    handleGameEnd() {
        if (!this.playerGame.isGameOver && !this.aiGame.isGameOver) return;
        if (!this.isRunning) return;
        this.isRunning = false;
        cancelAnimationFrame(this.animationFrameId);
        // 最後の1フレームを描いておく
        this.playerGame.draw();
        this.aiGame.draw();
        bgmManager.stop();

        let title, kind;
        if (this.playerGame.isGameOver && this.aiGame.isGameOver) {
            title = 'DRAW'; kind = 'draw';
            soundManager.playLineClear(2);
        } else if (this.playerGame.isGameOver) {
            title = this.aiVsAi ? 'AI2 WIN' : 'AI WIN'; kind = 'lose';
            if (!this.aiVsAi) soundManager.playGameOver();
        } else {
            title = this.aiVsAi ? 'AI1 WIN' : 'YOU WIN!'; kind = 'win';
            if (!this.aiVsAi) soundManager.playWin();
        }
        if (this.ui.onEnd) this.ui.onEnd(title, kind);
    }

    togglePause(force) {
        if (!this.isRunning) return;
        const next = force === undefined ? !this.isPaused : force;
        if (next === this.isPaused) return;
        this.isPaused = next;
        if (next) bgmManager.pause();
        else { bgmManager.resume(); this.lastUpdateTime = performance.now(); }
        if (this.ui.onPause) this.ui.onPause(next);
    }

    cleanup() {
        this.isRunning = false;
        cancelAnimationFrame(this.animationFrameId);
        this.playerGame?.cleanup();
        this.aiGame?.cleanup();
        this.playerGame = null;
        this.aiGame = null;
    }
}
