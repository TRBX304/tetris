// ===========================================
// TetrisGame: ゲーム本体（1盤面ぶん）
// ===========================================
import {
    BOARD_WIDTH, BOARD_HEIGHT, BUFFER_HEIGHT, TOTAL_HEIGHT,
    SPRINT_DURATION_MS, LOCK_DELAY_MS, MAX_LOCK_RESETS, NEXT_COUNT,
    LINE_CLEAR_MS, HITSTOP_MS, GAME_STATES, GARBAGE_COLOR
} from './config.js';
import { Tetromino, getKicks, trimmedShape, SHAPES } from './pieces.js';
import { SeededRandom, shuffledBag } from './rng.js';
import { soundManager, bgmManager } from './audio.js';
import { Effects } from './effects.js';
import { TetrisAI } from './ai.js';
import { RankingSession } from './ranking.js';
import { saveRecord } from './records.js';
import { settings } from './settings.js';
import { PIECE_COLORS } from './config.js';

const noop = () => {};

// フラット2.0のブロック（上にハイライト、下に影）。オンライン対戦の相手盤面でも使う
export function drawBlock(ctx, x, y, size, color) {
    const g = Math.max(1, size * 0.05);
    ctx.fillStyle = color;
    ctx.fillRect(x + g, y + g, size - g * 2, size - g * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + g, y + g, size - g * 2, size * 0.14);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + g, y + size - g - size * 0.12, size - g * 2, size * 0.12);
}

export class TetrisGame {
    /**
     * @param {string} mode  normal / sprint1m / time10.. / practice / battle
     * @param {boolean} aiEnabled AIが操作するか
     * @param {object} options canvasId, nextCanvasId, holdCanvasId(null可), blockSize,
     *                         isBattle, onGameOver, onGarbageSend, popupEl, hooks
     */
    constructor(mode = 'normal', aiEnabled = false, options = {}) {
        this.mode = mode;
        this.isAIMode = aiEnabled;
        this.isPracticeMode = mode === 'practice';
        this.isBattleMode = options.isBattle || false;
        this.onGameOver = options.onGameOver || null;
        this.onGarbageSend = options.onGarbageSend || null;
        this.blockSizeFn = options.blockSizeFn || null;
        this.fixedBlockSize = options.blockSize || null;

        // UIへの通知（ui.js / battle.js から渡される）
        const h = options.hooks || {};
        this.hooks = {
            onStats: h.onStats || noop,
            onTime: h.onTime || noop,
            onFinish: h.onFinish || noop,
            onPause: h.onPause || noop
        };

        this.canvas = document.getElementById(options.canvasId || 'gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.nextCanvas = document.getElementById(options.nextCanvasId || 'nextCanvas');
        this.nextCtx = this.nextCanvas ? this.nextCanvas.getContext('2d') : null;
        const holdId = options.holdCanvasId === undefined ? 'holdCanvas' : options.holdCanvasId;
        this.holdCanvas = holdId ? document.getElementById(holdId) : null;
        this.holdCtx = this.holdCanvas ? this.holdCanvas.getContext('2d') : null;

        this.effects = new Effects(this, { popupEl: options.popupEl || null });
        this.onAfterBackgroundDraw = null;

        this.resize();
        this.initializeGameState();
        this.init();
    }

    // ===========================================
    // サイズ（高解像度ディスプレイ対応）
    // ===========================================
    resize() {
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.blockSize = this.fixedBlockSize || (this.blockSizeFn ? this.blockSizeFn() : 24);
        const w = BOARD_WIDTH * this.blockSize;
        const h = BOARD_HEIGHT * this.blockSize;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this._setupSmallCanvas(this.nextCanvas, this.nextCtx);
        this._setupSmallCanvas(this.holdCanvas, this.holdCtx);
        if (this.board) { this.draw(); this.drawNext(); this.drawHold(); }
    }

    _setupSmallCanvas(c, ctx) {
        if (!c) return;
        // CSSで決めた表示サイズを内部解像度に反映
        if (!c._baseW) { c._baseW = c.width; c._baseH = c.height; }
        const w = c.clientWidth || c._baseW;
        const h = c.clientHeight || c._baseH;
        c._w = w; c._h = h;
        c.width = Math.round(w * this.dpr);
        c.height = Math.round(h * this.dpr);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    initializeGameState() {
        this.board = [];
        this.currentPiece = null;
        this.queue = [];
        this.pieceBag = [];

        this.score = 0;
        this.level = 1;
        this.linesCleared = 0;

        this.gameState = GAME_STATES.PLAYING;
        this.isGameOver = false;
        this.isPaused = false;

        this.lastMoveWasRotation = false;
        this.lastKickIndex = -1;

        // ロックディレイ
        this.lockTimer = 0;
        this.lockResets = 0;
        this.lowestY = -99;
        this.dropTimer = 0;

        // タイマー
        this.startTime = null;
        this.elapsedTime = 0;
        this.timerInterval = null;
        this.timerStarted = false;
        this.pausedTime = 0;

        // ライン消去
        this.lineClearData = null;
        this.clearElapsed = 0;

        this.lastUpdateTime = 0;
        this.animationFrameId = null;
        this.targetLines = this.getTargetLines();

        // AI
        this.ai = null;
        this.aiMoveQueue = [];
        this.aiMoveTimer = 0;
        this.aiMoveInterval = 50;

        // 対戦
        this.pendingGarbage = 0;
        this.comboCount = 0;
        this.isBackToBack = false;
        this.damageNumbers = [];

        // ホールド
        this.holdPieceType = null;
        this.holdUsed = false;

        // 練習モード Undo
        this.undoHistory = [];
        this.maxUndoHistory = 30;

        // 世界ランキング用シード
        this.seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
        this.rng = new SeededRandom(this.seed);
        this.rs = null;   // RankingSession
    }

    getTargetLines() {
        const t = { time10: 10, time20: 20, time40: 40, time100: 100, sprint1m: Infinity };
        return t[this.mode] || null;
    }

    get isRanked() {
        return !this.isAIMode && !this.isBattleMode && !this.isPracticeMode;
    }

    // ===========================================
    // 初期化
    // ===========================================
    init() {
        this.board = Array.from({ length: TOTAL_HEIGHT }, () => Array(BOARD_WIDTH).fill(null));

        while (this.queue.length < NEXT_COUNT) this.queue.push(this.getNextPieceFromBag());
        this.spawnNewPiece();
        this.drawHold();

        if (this.isAIMode) {
            this.ai = new TetrisAI(this);
            this.planAIMove();
        }

        if (!this.isBattleMode) {
            this.lastUpdateTime = performance.now();
            this.startGameLoop();
        }

        if (this.isRanked) {
            this.rs = new RankingSession(this.seed, this.mode);
            this.rs.start();
        }
        this.hooks.onStats(this);
    }

    _logOp(type, payload) {
        if (this.rs) this.rs.log(type, payload);
    }

    // 7-bag（サーバーの generatePieceSequence と同じ順番になる）
    getNextPieceFromBag() {
        if (this.pieceBag.length === 0) this.pieceBag = shuffledBag(this.rng);
        return this.pieceBag.shift();
    }

    // ===========================================
    // タイマー
    // ===========================================
    _runTimer() {
        this.startTime = Date.now() - this.pausedTime;
        this.timerInterval = setInterval(() => {
            if (this.isPaused || this.isGameOver) return;
            this.elapsedTime = Date.now() - this.startTime;
            this.hooks.onTime(this);
            if (this.mode === 'sprint1m' && this.elapsedTime >= SPRINT_DURATION_MS) {
                this.elapsedTime = SPRINT_DURATION_MS;
                this.endSprintMode();
            }
        }, 10);
    }

    startTimer() {
        if (this.timerInterval !== null) return;
        this.timerStarted = true;
        this._runTimer();
    }

    pauseTimer() {
        if (this.timerInterval === null) return;
        this.pausedTime = this.elapsedTime;
        clearInterval(this.timerInterval);
        this.timerInterval = null;
    }

    resumeTimer() {
        if (this.timerInterval === null && this.timerStarted) this._runTimer();
    }

    stopTimer() {
        if (this.timerInterval !== null) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    // ===========================================
    // ゲームループ
    // ===========================================
    startGameLoop() {
        const loop = (now) => {
            if (this.isGameOver) {
                // 終了後も少しだけ描画を続けて演出を最後まで見せる
                if (!this._endAt) this._endAt = now;
                this.draw();
                if (now - this._endAt < 1500) this.animationFrameId = requestAnimationFrame(loop);
                return;
            }
            const dt = Math.min(100, now - this.lastUpdateTime);
            this.lastUpdateTime = now;
            if (!this.isPaused) this.update(dt);
            this.draw();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        this.animationFrameId = requestAnimationFrame(loop);
    }

    update(dt) {
        if (this.isGameOver) return;
        if (!this.timerStarted && this.currentPiece && !this.isPracticeMode && !this.isBattleMode) {
            this.startTimer();
        }

        if (this.gameState === GAME_STATES.LINE_CLEARING) {
            this.clearElapsed += dt;
            if (this.clearElapsed >= LINE_CLEAR_MS + HITSTOP_MS) this.completeClearLines();
            return;
        }

        // 練習モード: 自動落下・自動固定なし
        if (this.isPracticeMode) return;
        if (this.gameState !== GAME_STATES.PLAYING || !this.currentPiece) return;

        if (this.isAIMode) {
            this.updateAI(dt);
            return;
        }
        this.applyGravity(dt);
    }

    // 落下とロックディレイ
    applyGravity(dt) {
        const p = this.currentPiece;
        if (this.checkCollision(p, 0, 1)) {
            // 接地中: 0.5秒たったら固定
            this.lockTimer += dt;
            if (this.lockTimer >= LOCK_DELAY_MS) this.lockPiece();
            return;
        }
        this.lockTimer = 0;
        const interval = Math.max(200, 700 - (this.level - 1) * 50);
        this.dropTimer += dt;
        if (this.dropTimer >= interval) {
            this.dropTimer = 0;
            p.position.y++;
            this._onDescend();
        }
    }

    // 新しい最低位置まで落ちたらリセット回数を戻す（本家と同じ）
    _onDescend() {
        const p = this.currentPiece;
        if (p.position.y > this.lowestY) {
            this.lowestY = p.position.y;
            this.lockResets = 0;
            this.lockTimer = 0;
        }
    }

    // 移動・回転に成功したとき: 接地中ならロックディレイをリセット（15回まで）
    _onMoved() {
        if (this.lockTimer > 0 || this.checkCollision(this.currentPiece, 0, 1)) {
            if (this.lockResets < MAX_LOCK_RESETS) {
                this.lockTimer = 0;
                this.lockResets++;
            }
        }
    }

    // ===========================================
    // AI
    // ===========================================
    updateAI(dt) {
        this.aiMoveTimer += dt;
        if (this.aiMoveTimer < this.aiMoveInterval) return;
        this.aiMoveTimer = 0;
        if (this.aiMoveQueue.length > 0) {
            this.executeAIMove(this.aiMoveQueue.shift());
        } else {
            this.planAIMove();
        }
    }

    planAIMove() {
        if (!this.ai || !this.currentPiece) return;
        const best = this.ai.findBestMove();
        this.aiMoveQueue = best ? this.ai.generateMoveQueue(best) : ['drop'];
    }

    executeAIMove(move) {
        if (!this.currentPiece) return;
        if (typeof move === 'object' && move.alignTo !== undefined) {
            // 目標のxに着くまで1マスずつ動く
            const x = this.currentPiece.position.x;
            if (x === move.alignTo) return;
            const ok = x < move.alignTo ? this.moveRightInternal() : this.moveLeftInternal();
            if (ok) this.aiMoveQueue.unshift(move);
            return;
        }
        switch (move) {
            case 'left': this.moveLeftInternal(); break;
            case 'right': this.moveRightInternal(); break;
            case 'rotate': this.rotateInternal(); break;
            case 'drop': this.hardDropInternal(); break;
        }
    }

    moveLeftInternal() {
        if (!this.currentPiece || this.checkCollision(this.currentPiece, -1, 0)) return false;
        this.currentPiece.position.x--;
        this.lastMoveWasRotation = false;
        return true;
    }

    moveRightInternal() {
        if (!this.currentPiece || this.checkCollision(this.currentPiece, 1, 0)) return false;
        this.currentPiece.position.x++;
        this.lastMoveWasRotation = false;
        return true;
    }

    rotateInternal(dir = 1) {
        if (!this.currentPiece) return false;
        const k = this.tryRotate(dir);
        if (k < 0) return false;
        this.lastMoveWasRotation = true;
        this.lastKickIndex = k;
        return true;
    }

    hardDropInternal() {
        if (!this.currentPiece) return;
        while (!this.checkCollision(this.currentPiece, 0, 1)) this.currentPiece.position.y++;
        this.lockPiece(true);
    }

    // ===========================================
    // ピース生成
    // ===========================================
    spawnNewPiece() {
        if (this.isGameOver) return;

        if (this.pendingGarbage > 0) {
            this.addGarbageLines(this.pendingGarbage);
            this.pendingGarbage = 0;
        }

        const type = this.queue.shift();
        this.queue.push(this.getNextPieceFromBag());
        const piece = new Tetromino(type);
        this.drawNext();

        this.lockTimer = 0;
        this.lockResets = 0;
        this.lowestY = piece.position.y;
        this.dropTimer = 0;
        this.holdUsed = false;
        this.lastMoveWasRotation = false;
        this.lastKickIndex = -1;
        this.drawHold();

        // ブロックアウト: 出現位置がふさがっている
        if (this.checkCollision(piece, 0, 0)) {
            this.currentPiece = null;
            this.triggerGameOver();
            return;
        }
        this.currentPiece = piece;
        this.gameState = GAME_STATES.PLAYING;

        if (this.isPracticeMode) this.saveStateForUndo();
        if (this.isAIMode && this.ai) {
            this.aiMoveQueue = [];
            this.planAIMove();
        }
    }

    // 練習モード: Undo
    saveStateForUndo() {
        this.undoHistory.push({
            board: this.board.map(r => [...r]),
            currentPiece: this.currentPiece ? this.currentPiece.clone() : null,
            queue: [...this.queue],
            pieceBag: [...this.pieceBag],
            rngS: this.rng.s,
            holdPieceType: this.holdPieceType,
            score: this.score,
            level: this.level,
            linesCleared: this.linesCleared,
            comboCount: this.comboCount,
            isBackToBack: this.isBackToBack
        });
        if (this.undoHistory.length > this.maxUndoHistory) this.undoHistory.shift();
    }

    undo() {
        if (!this.isPracticeMode || this.isGameOver) return false;
        if (this.gameState !== GAME_STATES.PLAYING) return false;
        // 最新の履歴は「今のミノ」なので、1つ前に戻る
        if (this.undoHistory.length < 2) {
            if (this.undoHistory.length === 1) this._restore(this.undoHistory[0]);
            return false;
        }
        this.undoHistory.pop();
        this._restore(this.undoHistory[this.undoHistory.length - 1]);
        return true;
    }

    _restore(s) {
        this.board = s.board.map(r => [...r]);
        this.currentPiece = s.currentPiece ? s.currentPiece.clone() : null;
        this.queue = [...s.queue];
        this.pieceBag = [...s.pieceBag];
        this.rng.s = s.rngS;
        this.holdPieceType = s.holdPieceType;
        this.holdUsed = false;
        this.score = s.score;
        this.level = s.level;
        this.linesCleared = s.linesCleared;
        this.comboCount = s.comboCount;
        this.isBackToBack = s.isBackToBack;
        this.effects.clear();
        this.hooks.onStats(this);
        this.drawNext();
        this.drawHold();
    }

    // 対戦: おじゃまライン
    addGarbageLines(count) {
        for (let i = 0; i < count; i++) this.board.shift();
        const hole = Math.floor(Math.random() * BOARD_WIDTH);
        for (let i = 0; i < count; i++) {
            const line = Array(BOARD_WIDTH).fill(GARBAGE_COLOR);
            line[hole] = null;
            this.board.push(line);
        }
        soundManager.playGarbageReceive();
    }

    receiveGarbage(count) {
        this.pendingGarbage += count;
    }

    checkCollision(piece, offsetX, offsetY) {
        if (!piece || !piece.shape) return true;
        const s = piece.shape;
        for (let i = 0; i < s.length; i++) {
            for (let j = 0; j < s[i].length; j++) {
                if (!s[i][j]) continue;
                const x = piece.position.x + j + offsetX;
                const boardY = piece.position.y + i + offsetY + BUFFER_HEIGHT;
                if (x < 0 || x >= BOARD_WIDTH || boardY >= TOTAL_HEIGHT) return true;
                if (boardY < 0) continue;
                if (this.board[boardY][x] !== null) return true;
            }
        }
        return false;
    }

    // ===========================================
    // プレイヤー操作
    // ===========================================
    _canAct() {
        return !this.isAIMode && this.currentPiece && !this.isPaused && !this.isGameOver
            && this.gameState === GAME_STATES.PLAYING;
    }

    moveLeft() { return this._shift(-1); }
    moveRight() { return this._shift(1); }

    _shift(dx) {
        if (!this._canAct()) return false;
        if (this.checkCollision(this.currentPiece, dx, 0)) return false;
        this.currentPiece.position.x += dx;
        this.lastMoveWasRotation = false;
        this._logOp(dx < 0 ? 'L' : 'R');
        soundManager.playMove();
        this._onMoved();
        return true;
    }

    // SRSで回転。成功したらキックの番号（0〜4）、失敗したら -1
    tryRotate(dir) {
        const p = this.currentPiece;
        if (p.type === 'O') return -1;
        const r = p.rotated(dir);
        const kicks = getKicks(p.type, p.rot, r.rot);
        for (let i = 0; i < kicks.length; i++) {
            const [dx, dy] = kicks[i];
            if (!this.checkCollision(r, dx, dy)) {
                r.position.x += dx;
                r.position.y += dy;
                this.currentPiece = r;
                return i;
            }
        }
        return -1;
    }

    // dir: 1 = 右回転（A / ↑ / X）, -1 = 左回転（B / Z）
    rotate(dir = 1) {
        if (!this._canAct()) return false;
        const k = this.tryRotate(dir);
        if (k < 0) return false;
        this.lastMoveWasRotation = true;
        this.lastKickIndex = k;
        this._logOp(dir > 0 ? 'U' : 'UL');
        soundManager.playRotate();
        this._onMoved();
        return true;
    }

    hardDrop() {
        if (!this._canAct()) return;
        const p = this.currentPiece;
        const fromY = p.position.y;
        while (!this.checkCollision(p, 0, 1)) p.position.y++;
        if (p.position.y > fromY) this.lastMoveWasRotation = false;
        this.effects.hardDrop(p, fromY, p.position.y);
        soundManager.playHardDrop();
        this._logOp('D');
        this.lockPiece(true);
    }

    // ソフトドロップ（接地中は何もしない。固定はロックディレイに任せる）
    moveDown(manual = false) {
        if (manual && !this._canAct()) return;
        if (!this.currentPiece || this.isGameOver || this.gameState !== GAME_STATES.PLAYING) return;
        if (this.checkCollision(this.currentPiece, 0, 1)) return;
        this.currentPiece.position.y++;
        this.lastMoveWasRotation = false;
        this.dropTimer = 0;
        this._onDescend();
    }

    // ホールド（1つのミノにつき1回まで）
    hold() {
        if (!this._canAct() || this.holdUsed) return;
        const cur = this.currentPiece.type;
        this._logOp('H');
        if (this.holdPieceType === null) {
            this.holdPieceType = cur;
            this.spawnNewPiece();
        } else {
            const t = this.holdPieceType;
            this.holdPieceType = cur;
            const piece = new Tetromino(t);
            this.lockTimer = 0;
            this.lockResets = 0;
            this.lowestY = piece.position.y;
            this.dropTimer = 0;
            if (this.checkCollision(piece, 0, 0)) {
                this.currentPiece = null;
                this.triggerGameOver();
                return;
            }
            this.currentPiece = piece;
        }
        this.holdUsed = true;
        this.lastMoveWasRotation = false;
        this.drawHold();
        soundManager.playHold();
    }

    // ===========================================
    // 固定とライン消去
    // ===========================================
    lockPiece(hard = false) {
        const p = this.currentPiece;
        if (!p) return;
        const tspin = this.checkTSpin(p);
        let allInBuffer = true;
        const cells = p.cells();
        for (const c of cells) {
            const by = c.y + BUFFER_HEIGHT;
            if (by >= 0 && by < TOTAL_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
                this.board[by][c.x] = p.color;
                if (by >= BUFFER_HEIGHT) allInBuffer = false;
            }
        }
        if (!hard) {
            this._logOp('K');   // ハードドロップ以外の固定（サーバーでドロップ数として数える）
            if (!this.isAIMode) soundManager.playLock();
        }
        this.effects.lock(cells);
        this.currentPiece = null;
        this.lastMoveWasRotation = false;

        // ロックアウト: 全部が画面外（バッファ内）で固定された
        if (allInBuffer) {
            this.triggerGameOver();
            return;
        }
        this.processLineClear(tspin);
    }

    // T-spin 判定（3コーナールール + Mini）
    // 戻り値: 'full' / 'mini' / null
    checkTSpin(piece) {
        if (piece.type !== 'T' || !this.lastMoveWasRotation) return null;
        const { x, y } = piece.position;
        const filled = (cx, cy) => {
            const by = cy + BUFFER_HEIGHT;
            if (cx < 0 || cx >= BOARD_WIDTH || by >= TOTAL_HEIGHT) return true;
            if (by < 0) return false;
            return this.board[by][cx] !== null;
        };
        // 左上, 右上, 右下, 左下
        const c = [filled(x, y), filled(x + 2, y), filled(x + 2, y + 2), filled(x, y + 2)];
        if (c.filter(Boolean).length < 3) return null;
        // Tの出っ張りが向いている側の2つの角
        const front = [[0, 1], [1, 2], [2, 3], [3, 0]][piece.rot];
        if ((c[front[0]] && c[front[1]]) || this.lastKickIndex === 4) return 'full';
        return 'mini';
    }

    processLineClear(tspin) {
        const lines = [];
        for (let by = BUFFER_HEIGHT; by < TOTAL_HEIGHT; by++) {
            if (this.board[by].every(cell => cell !== null)) lines.push(by);
        }

        if (lines.length > 0) {
            this.gameState = GAME_STATES.LINE_CLEARING;
            this.lineClearData = { lines, tspin, count: lines.length };
            this.clearElapsed = 0;
        } else {
            if (tspin) {
                this.effects.popText(tspin === 'mini' ? 'T-SPIN MINI' : 'T-SPIN', 'tspin');
                soundManager.playTSpin();
            }
            this.comboCount = 0;
            this.spawnNewPiece();
        }
    }

    completeClearLines() {
        const data = this.lineClearData;
        if (!data) {
            this.gameState = GAME_STATES.PLAYING;
            this.spawnNewPiece();
            return;
        }

        // 演出用: 消える行の色と、残る行が何段落ちるか
        const clearedRows = data.lines.map(by => ({ y: by - BUFFER_HEIGHT, colors: [...this.board[by]] }));
        const kept = [];
        const keptShift = [];
        let below = 0;
        for (let by = TOTAL_HEIGHT - 1; by >= 0; by--) {
            if (data.lines.includes(by)) { below++; continue; }
            kept.unshift(this.board[by]);
            keptShift.unshift(below);
        }
        const newBoard = kept;
        const shifts = keptShift;
        while (newBoard.length < TOTAL_HEIGHT) {
            newBoard.unshift(Array(BOARD_WIDTH).fill(null));
            shifts.unshift(data.count);
        }
        this.board = newBoard;

        const isPerfectClear = this.board.every(row => row.every(cell => cell === null));
        this.comboCount++;

        // ---- スコア計算（旧版と同じ。T-spin Mini だけ追加） ----
        const scoreTable = { 1: 25, 2: 100, 3: 400, 4: 1600 };
        this.score += (scoreTable[data.count] || 25) * (this.level + 1);

        let garbageToSend = 0;
        let actionText = '';
        let kind = 'normal';
        const isDifficult = data.count === 4 || (data.tspin && data.count > 0);

        let btbBonus = 0;
        if (isDifficult) {
            if (this.isBackToBack) {
                btbBonus = 1;
                actionText = 'BtB ';
                soundManager.playBackToBack();
            }
            this.isBackToBack = true;
        } else if (data.count > 0) {
            this.isBackToBack = false;
        }

        const spinNames = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE' };
        if (data.tspin === 'full') {
            this.score += data.count * 400 * this.level;
            actionText += `T-SPIN ${spinNames[data.count] || ''}`;
            garbageToSend = data.count * 2 + btbBonus;
            kind = 'tspin';
            soundManager.playTSpin();
        } else if (data.tspin === 'mini') {
            this.score += data.count * 100 * this.level;
            actionText += `T-SPIN MINI ${spinNames[data.count] || ''}`;
            garbageToSend = (data.count >= 2 ? data.count : 0) + btbBonus;
            kind = 'tspin';
            soundManager.playTSpin();
        } else if (data.count === 4) {
            this.score += 800 * this.level;
            actionText += 'TETRIS!';
            garbageToSend = 4 + btbBonus;
            kind = 'tetris';
            soundManager.playTetris();
        } else if (data.count >= 2) {
            actionText += { 2: 'DOUBLE', 3: 'TRIPLE' }[data.count];
            garbageToSend = data.count - 1;
            soundManager.playLineClear(data.count);
        } else {
            soundManager.playLineClear(1);
        }

        if (isPerfectClear) {
            this.score += 3000 * this.level;
            actionText = 'PERFECT CLEAR!';
            garbageToSend = 10;
            kind = 'pc';
            soundManager.playWin();
        }

        let renText = '';
        if (this.comboCount >= 2) {
            garbageToSend += this.comboCount - 1;
            renText = `${this.comboCount} REN`;
            soundManager.playCombo(this.comboCount);
        }

        const clearedLineY = Math.min(...data.lines) - BUFFER_HEIGHT;

        // 対戦: 相殺とおじゃま送信
        let actualDamage = 0;
        if (this.isBattleMode && garbageToSend > 0) {
            if (this.pendingGarbage > 0) {
                soundManager.playCounter();
                if (garbageToSend >= this.pendingGarbage) {
                    garbageToSend -= this.pendingGarbage;
                    this.pendingGarbage = 0;
                } else {
                    this.pendingGarbage -= garbageToSend;
                    garbageToSend = 0;
                }
                renText = renText ? `${renText} 相殺` : '相殺';
            }
            if (garbageToSend > 0 && this.onGarbageSend) {
                actualDamage = garbageToSend;
                this.onGarbageSend(garbageToSend);
            }
        }

        // 演出
        this.effects.lineClear({
            rows: clearedRows, shifts, count: data.count, tspin: !!data.tspin, perfect: isPerfectClear
        });
        const popup = [actionText.trim(), renText].filter(Boolean).join('  ');
        if (popup) this.effects.popText(popup, kind === 'normal' && renText ? 'ren' : kind);
        if (this.isBattleMode && actualDamage > 0) this.showDamageNumber(actualDamage, clearedLineY);

        this.linesCleared += data.count;
        this._logOp('LINE', { count: data.count });

        const newLevel = Math.floor(this.linesCleared / 10) + 1;
        if (newLevel > this.level) this.level = newLevel;
        this.hooks.onStats(this);

        this.lineClearData = null;

        if (this.targetLines !== null && this.targetLines !== Infinity && this.linesCleared >= this.targetLines) {
            this.completeTimeAttack();
            return;
        }

        this.gameState = GAME_STATES.PLAYING;
        this.spawnNewPiece();
    }

    // ===========================================
    // ゲーム終了
    // ===========================================
    _stopAll() {
        this.isGameOver = true;
        this.gameState = GAME_STATES.GAME_OVER;
        this.stopTimer();
    }

    triggerGameOver() {
        if (this.isGameOver) return;
        this._stopAll();

        if (this.isBattleMode && this.onGameOver) {
            this.onGameOver();
            return;
        }

        bgmManager.stop();
        soundManager.playGameOver();

        if (this.mode === 'normal') {
            this._logOp('SCORE', { score: this.score });
            saveRecord(this);
        }
        this.hooks.onFinish('gameover', this);
    }

    endSprintMode() {
        if (this.isGameOver) return;
        this._stopAll();
        bgmManager.stop();
        soundManager.playWin();
        this._logOp('LINES', { lines: this.linesCleared });
        this._logOp('TIME', { time_ms: this.elapsedTime });
        saveRecord(this);
        this.hooks.onFinish('sprint', this);
    }

    completeTimeAttack() {
        if (this.isGameOver) return;
        // 最後の更新からのずれを補正
        if (this.timerStarted && this.startTime) this.elapsedTime = Date.now() - this.startTime;
        this._stopAll();
        bgmManager.stop();
        soundManager.playWin();
        this._logOp('TIME', { time_ms: this.elapsedTime });
        saveRecord(this);
        this.hooks.onFinish('timeattack', this);
    }

    // ===========================================
    // 描画
    // ===========================================
    draw() {
        const ctx = this.ctx;
        const bs = this.blockSize;
        const W = BOARD_WIDTH * bs;
        const H = BOARD_HEIGHT * bs;

        ctx.fillStyle = '#121729';
        ctx.fillRect(0, 0, W, H);

        // グリッド線
        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 1; x < BOARD_WIDTH; x++) { ctx.moveTo(x * bs + 0.5, 0); ctx.lineTo(x * bs + 0.5, H); }
        for (let y = 1; y < BOARD_HEIGHT; y++) { ctx.moveTo(0, y * bs + 0.5); ctx.lineTo(W, y * bs + 0.5); }
        ctx.stroke();

        if (this.onAfterBackgroundDraw) this.onAfterBackgroundDraw(ctx, bs);

        // 固定ブロック
        const clearing = this.gameState === GAME_STATES.LINE_CLEARING && this.lineClearData;
        const flashA = clearing ? Math.max(0, 1 - this.clearElapsed / (LINE_CLEAR_MS + HITSTOP_MS)) : 0;
        for (let sy = 0; sy < BOARD_HEIGHT; sy++) {
            const by = sy + BUFFER_HEIGHT;
            const off = this.effects.rowOffset(by);
            for (let x = 0; x < BOARD_WIDTH; x++) {
                const color = this.board[by][x];
                if (!color) continue;
                if (clearing && this.lineClearData.lines.includes(by)) {
                    this.drawBlock(ctx, x * bs, sy * bs, bs, color);
                    ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * flashA})`;
                    ctx.fillRect(x * bs, sy * bs, bs, bs);
                } else {
                    this.drawBlock(ctx, x * bs, sy * bs - off, bs, color);
                }
            }
        }

        // ゴーストと操作中のミノ
        const p = this.currentPiece;
        if (p) {
            const ghost = p.clone();
            while (!this.checkCollision(ghost, 0, 1)) ghost.position.y++;
            ctx.lineWidth = 2;
            for (const c of ghost.cells()) {
                if (c.y < 0) continue;
                ctx.fillStyle = p.color + '26';
                ctx.fillRect(c.x * bs, c.y * bs, bs, bs);
                ctx.strokeStyle = p.color + '80';
                ctx.strokeRect(c.x * bs + 2, c.y * bs + 2, bs - 4, bs - 4);
            }
            // 接地中はロックディレイの残りに応じて明るくなる
            const glow = this.lockTimer > 0 ? Math.min(1, this.lockTimer / LOCK_DELAY_MS) : 0;
            for (const c of p.cells()) {
                if (c.y < 0) continue;
                this.drawBlock(ctx, c.x * bs, c.y * bs, bs, p.color);
                if (glow > 0) {
                    ctx.fillStyle = `rgba(255,255,255,${(0.4 * glow).toFixed(3)})`;
                    ctx.fillRect(c.x * bs, c.y * bs, bs, bs);
                }
            }
        }

        // 対戦: 受けるおじゃまの予告
        if (this.pendingGarbage > 0) {
            ctx.fillStyle = '#ff5a5a';
            const n = Math.min(this.pendingGarbage, BOARD_HEIGHT);
            ctx.fillRect(0, H - n * bs, 4, n * bs);
        }

        this.effects.draw(ctx);
        this.drawDamageNumbers(ctx);
    }

    // フラット2.0のブロック（上にハイライト、下に影）
    drawBlock(ctx, x, y, size, color) {
        drawBlock(ctx, x, y, size, color);
    }

    _drawMini(ctx, type, cx, cy, bs, color) {
        const shape = trimmedShape(type);
        const w = shape[0].length * bs;
        const h = shape.length * bs;
        const ox = cx - w / 2;
        const oy = cy - h / 2;
        shape.forEach((row, i) => row.forEach((v, j) => {
            if (v) this.drawBlock(ctx, ox + j * bs, oy + i * bs, bs, color);
        }));
    }

    drawNext() {
        const c = this.nextCanvas, ctx = this.nextCtx;
        if (!c || !ctx) return;
        const w = c._w, h = c._h;
        ctx.clearRect(0, 0, w, h);
        const n = Math.min(NEXT_COUNT, this.queue.length);
        if (n === 0) return;
        // 2つ目以降のサイズは前のまま
        const slot = h / (n + 0.4);
        const baseBs = Math.min(w / 4.6, slot / 2.6);
        const restBs = baseBs * 0.78;

        // 1つ目: 上の42%を使って大きく表示（ミノの横幅に合わせて、枠いっぱいまで）
        const firstH = h * 0.42;
        const first = this.queue[0];
        const s0 = trimmedShape(first);
        const bs0 = Math.min((w * 0.94) / s0[0].length, (firstH * 0.8) / s0.length, baseBs * 1.35);
        this._drawMini(ctx, first, w / 2, firstH / 2, bs0, PIECE_COLORS[first]);

        // 2つ目以降: 残りを等分。少し薄くして「次はこれ」をはっきりさせる
        const restH = (h - firstH) / Math.max(1, n - 1);
        ctx.globalAlpha = 0.6;
        this.queue.slice(1, n).forEach((type, i) => {
            this._drawMini(ctx, type, w / 2, firstH + restH * (i + 0.5), restBs, PIECE_COLORS[type]);
        });
        ctx.globalAlpha = 1;
    }

    drawHold() {
        const c = this.holdCanvas, ctx = this.holdCtx;
        if (!c || !ctx) return;
        const w = c._w, h = c._h;
        ctx.clearRect(0, 0, w, h);
        if (!this.holdPieceType) return;
        const bs = Math.min(w / 4.6, h / 2.6);
        const color = this.holdUsed ? '#4a5068' : PIECE_COLORS[this.holdPieceType];
        this._drawMini(ctx, this.holdPieceType, w / 2, h / 2, bs, color);
    }

    // 対戦: ダメージ数字
    showDamageNumber(damage, lineY) {
        this.damageNumbers.push({
            value: damage, x: this.canvas.width / this.dpr / 2, y: lineY * this.blockSize,
            startTime: performance.now()
        });
    }

    drawDamageNumbers(ctx) {
        if (!this.damageNumbers.length) return;
        const now = performance.now();
        this.damageNumbers = this.damageNumbers.filter(d => {
            const e = now - d.startTime;
            if (e > 1000) return false;
            const k = e / 1000;
            ctx.save();
            ctx.font = `800 ${this.blockSize * 1.4}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 1 - k;
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#0b0e17';
            ctx.strokeText(`+${d.value}`, d.x, d.y - 50 * k);
            ctx.fillStyle = '#ff7a59';
            ctx.fillText(`+${d.value}`, d.x, d.y - 50 * k);
            ctx.restore();
            return true;
        });
    }

    // ===========================================
    // 制御
    // ===========================================
    togglePause(force) {
        if (this.isGameOver) return;
        const next = force === undefined ? !this.isPaused : force;
        if (next === this.isPaused) return;
        this.isPaused = next;
        if (next) {
            this.pauseTimer();
            bgmManager.pause();
        } else {
            this.resumeTimer();
            bgmManager.resume();
            this.lastUpdateTime = performance.now();
        }
        this.hooks.onPause(next);
    }

    cleanup() {
        this.stopTimer();
        if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
        if (this.rs) this.rs.stop();
        this.effects.clear();
    }

    // ランキング登録（ゲーム終了後）
    async submitRanking(name) {
        if (!this.rs) return { ok: false, error: 'no_session' };
        const r = await this.rs.verifyAndSave(name);
        return r;
    }
}

export { SHAPES };
