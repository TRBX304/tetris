// ===========================================
// 定数定義
// ===========================================
const TETROMINO_TYPES = {
    I: { shape: [[1, 1, 1, 1]], color: '#00ffff' },
    O: { shape: [[1, 1], [1, 1]], color: '#ffff00' },
    T: { shape: [[0, 1, 0], [1, 1, 1]], color: '#800080' },
    S: { shape: [[0, 1, 1], [1, 1, 0]], color: '#00ff00' },
    Z: { shape: [[1, 1, 0], [0, 1, 1]], color: '#ff0000' },
    J: { shape: [[1, 0, 0], [1, 1, 1]], color: '#0000ff' },
    L: { shape: [[0, 0, 1], [1, 1, 1]], color: '#ff8800' }
};

const GAME_STATES = {
    PLAYING: 'PLAYING',
    LINE_CLEARING: 'LINE_CLEARING',
    GAME_OVER: 'GAME_OVER',
    PAUSED: 'PAUSED'
};

// ===========================================
// ボード設定と座標系
// ===========================================
// 
// 【座標系の説明】
// - ピース座標(y): -2〜19 の範囲で動作
//   - y < 0: バッファ領域（画面外・非表示）
//   - y >= 0: 表示領域（画面内）
//
// - ボード配列インデックス(boardY): 0〜21
//   - boardY = y + BUFFER_HEIGHT
//   - boardY 0〜1: バッファ（非表示）
//   - boardY 2〜21: 表示領域
//
// 【ゲームオーバー条件】
// - ブロックアウト: 新ピースがスポーン時に既存ブロックと衝突
// - ロックアウト: ピースがバッファ内（boardY < 2）に固定された
//
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;        // 表示領域の高さ
const BUFFER_HEIGHT = 2;        // 上バッファの高さ（本家テトリス仕様）
const TOTAL_HEIGHT = BOARD_HEIGHT + BUFFER_HEIGHT;  // ボード配列の総高さ（22）
const LINE_CLEAR_FRAMES = 12;
const SPRINT_DURATION_MS = 60000;

// ===========================================
// Tetrominoクラス
// ===========================================
class Tetromino {
    constructor(type) {
        this.type = type;
        this.shape = JSON.parse(JSON.stringify(TETROMINO_TYPES[type].shape));
        this.color = TETROMINO_TYPES[type].color;
        // スポーン位置: y=-1（バッファ内）から開始
        // ピースの下部が画面上端(y=0)付近に現れる
        this.position = { x: 3, y: -1 };
    }

    rotate() {
        const rows = this.shape.length;
        const cols = this.shape[0].length;
        const newShape = [];

        for (let j = 0; j < cols; j++) {
            const newRow = [];
            for (let i = rows - 1; i >= 0; i--) {
                newRow.push(this.shape[i][j]);
            }
            newShape.push(newRow);
        }

        const rotated = new Tetromino(this.type);
        rotated.shape = newShape;
        rotated.position = { ...this.position };
        return rotated;
    }

    clone() {
        const cloned = new Tetromino(this.type);
        cloned.shape = JSON.parse(JSON.stringify(this.shape));
        cloned.position = { ...this.position };
        return cloned;
    }
}

// ===========================================
// TetrisGameクラス
// ===========================================
class TetrisGame {
    constructor(mode = 'normal', aiEnabled = false, options = {}) {
        this.mode = mode;
        this.isAIMode = aiEnabled;  // AIモードフラグ
        this.isPracticeMode = mode === 'practice';
        this.isBattleMode = options.isBattle || false;
        this.canvasId = options.canvasId || 'gameCanvas';
        this.nextCanvasId = options.nextCanvasId || 'nextCanvas';
        this.blockSize = options.blockSize || this.calculateBlockSize();
        this.onGameOver = options.onGameOver || null;
        this.onGarbageSend = options.onGarbageSend || null;
        
        // キャンバス初期化
        this.canvas = document.getElementById(this.canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = BOARD_WIDTH * this.blockSize;
        this.canvas.height = BOARD_HEIGHT * this.blockSize;

        this.nextCanvas = document.getElementById(this.nextCanvasId);
        this.nextCtx = this.nextCanvas.getContext('2d');

        // ゲーム状態初期化
        this.initializeGameState();
        
        // ゲーム開始
        this.init();
        if (!this.isBattleMode) {
            this.updateModeInfo();
        }
    }

    initializeGameState() {
        this.board = [];
        this.currentPiece = null;
        this.nextPieceType = null;
        this.pieceBag = [];
        
        this.score = 0;
        this.level = 1;
        this.linesCleared = 0;
        
        this.gameState = GAME_STATES.PLAYING;
        this.isGameOver = false;
        this.isPaused = false;
        
        this.lastMoveWasRotation = false;
        this.lastAction = '';
        
        // タイマー関連
        this.startTime = null;
        this.elapsedTime = 0;
        this.timerInterval = null;
        this.timerStarted = false;
        this.pausedTime = 0;  // 一時停止時の経過時間を保存
        
        // ライン消去エフェクト
        this.lineClearData = null;
        this.flashingLines = [];
        this.flashCounter = 0;
        
        // ゲームループ
        this.lastUpdateTime = 0;
        this.dropTimer = 0;
        this.animationFrameId = null;
        
        // 目標ライン数
        this.targetLines = this.getTargetLines();
        
        // AI関連（isAIModeはコンストラクタで設定済み）
        this.ai = null;
        this.aiMoveQueue = [];
        this.aiMoveTimer = 0;
        this.aiMoveInterval = 50;  // AIの動作間隔（ms）
        
        // 対戦モード用
        this.pendingGarbage = 0;
        this.comboCount = 0;  // コンボ（REN）カウンター
        this.isBackToBack = false;  // Back-to-Backフラグ
        
        // 練習モード用Undo
        this.undoHistory = [];
        this.maxUndoHistory = 20;
    }

    getTargetLines() {
        const targets = {
            'time10': 10,
            'time20': 20,
            'time40': 40,
            'time100': 100,
            'sprint1m': Infinity
        };
        return targets[this.mode] || null;
    }

    calculateBlockSize() {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            const availableWidth = window.innerWidth - 120;
            const blockSize = Math.floor(availableWidth / BOARD_WIDTH);
            return Math.min(Math.max(blockSize, 20), 30);
        }
        return 25;
    }

    updateModeInfo() {
        const modeInfo = document.getElementById('modeInfo');
        const restartButton = document.getElementById('restartButton');
        const controlPanel = document.getElementById('controlTogglePanel');
        const undoButton = document.getElementById('undoButton');  // 追加
        
        const modeTexts = {
            'normal': '📊 ノーマルモード',
            'sprint1m': '⚡ 1分間スプリント',
            'time10': '⏱️ 10ライン タイムアタック',
            'time20': '⏱️ 20ライン タイムアタック',
            'time40': '⏱️ 40ライン タイムアタック',
            'time100': '⏱️ 100ライン タイムアタック',
            'practice': '📝 練習モード (Z: Undo)'
        };
        
        let displayText = modeTexts[this.mode] || '';
        
        // AIモードの場合は接頭辞を追加
        if (this.isAIMode) {
            displayText = '🤖 AI ' + displayText;
        }
        
        modeInfo.textContent = displayText;
        restartButton.style.display = (this.mode === 'normal') ? 'none' : 'block';
        
        // 練習モードの場合は取り消しボタンを表示  // 追加
        if (undoButton) {  // 追加
            undoButton.classList.toggle('hidden', this.mode !== 'practice');  // 追加
        }  // 追加
        
        // AIモードでは操作パネルを非表示
        if (controlPanel) {
            controlPanel.style.display = this.isAIMode ? 'none' : 'block';
        }
    }

    // ===========================================
    // 初期化
    // ===========================================
    init() {
        // ボード配列: 22行（上2行バッファ + 表示20行）
        this.board = Array(TOTAL_HEIGHT).fill(null).map(() => 
            Array(BOARD_WIDTH).fill(null)
        );

        this.fillPieceBag();
        this.nextPieceType = this.getNextPieceFromBag();
        this.spawnNewPiece();
        this.drawNext();
        
        // AIモードの場合はAIを初期化
        if (this.isAIMode) {
            this.ai = new TetrisAI(this);
            this.planAIMove();
        }
        
        // バトルモードでは外部（BattleManager）がゲームループを管理
        if (!this.isBattleMode) {
            this.lastUpdateTime = performance.now();
            this.startGameLoop();
        }
    }

    fillPieceBag() {
        const types = Object.keys(TETROMINO_TYPES);
        this.pieceBag = [...types];
        // Fisher-Yatesシャッフル
        for (let i = this.pieceBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.pieceBag[i], this.pieceBag[j]] = [this.pieceBag[j], this.pieceBag[i]];
        }
    }

    getNextPieceFromBag() {
        if (this.pieceBag.length === 0) {
            this.fillPieceBag();
        }
        return this.pieceBag.shift();
    }

    // ===========================================
    // タイマー管理
    // ===========================================
    startTimer() {
        if (this.timerInterval !== null) {
            return;
        }
        
        // 一時停止から再開する場合はstartTimeを調整
        this.startTime = Date.now() - this.pausedTime;
        this.timerStarted = true;
        
        this.timerInterval = setInterval(() => {
            if (!this.isPaused && !this.isGameOver) {
                this.elapsedTime = Date.now() - this.startTime;
                this.updateTimeDisplay();
                
                // 1分間スプリント: 時間切れチェック
                if (this.mode === 'sprint1m' && this.elapsedTime >= SPRINT_DURATION_MS) {
                    this.endSprintMode();
                }
            }
        }, 10);
    }
    
    pauseTimer() {
        if (this.timerInterval !== null) {
            // 現在の経過時間を保存
            this.pausedTime = this.elapsedTime;
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    resumeTimer() {
        if (this.timerInterval === null && this.timerStarted) {
            // 保存された経過時間からstartTimeを再計算
            this.startTime = Date.now() - this.pausedTime;
            
            this.timerInterval = setInterval(() => {
                if (!this.isPaused && !this.isGameOver) {
                    this.elapsedTime = Date.now() - this.startTime;
                    this.updateTimeDisplay();
                    
                    // 1分間スプリント: 時間切れチェック
                    if (this.mode === 'sprint1m' && this.elapsedTime >= SPRINT_DURATION_MS) {
                        this.endSprintMode();
                    }
                }
            }, 10);
        }
    }
    
    stopTimer() {
        if (this.timerInterval !== null) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimeDisplay() {
        const timeDisplay = document.getElementById('timeDisplay');
        const totalSeconds = this.elapsedTime / 1000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const milliseconds = Math.floor((totalSeconds % 1) * 1000);
        
        if (this.mode === 'normal') {
            timeDisplay.textContent = `⏱️ ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
            timeDisplay.textContent = `⏱️ ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
        }
    }

    // ===========================================
    // ゲームループ
    // ===========================================
    startGameLoop() {
        const gameLoop = (currentTime) => {
            if (this.isGameOver) {
                return;
            }

            const deltaTime = currentTime - this.lastUpdateTime;
            this.lastUpdateTime = currentTime;

            if (!this.isPaused) {
                this.update(deltaTime);
            }

            this.draw();
            this.animationFrameId = requestAnimationFrame(gameLoop);
        };

        this.animationFrameId = requestAnimationFrame(gameLoop);
    }

    update(deltaTime) {
        // バトルモードではタイマーは外部管理
        // ゲーム開始時にタイマースタート（練習モードとバトルモード以外）
        if (!this.timerStarted && this.currentPiece !== null && !this.isPracticeMode && !this.isBattleMode) {
            this.startTimer();
        }
        
        // ライン消去中の処理
        if (this.gameState === GAME_STATES.LINE_CLEARING) {
            if (this.lineClearData !== null) {
                this.lineClearData.frameCount++;
                if (this.lineClearData.frameCount >= LINE_CLEAR_FRAMES) {
                    this.completeClearLines();
                }
            }
            return;
        }
        
        // 練習モード: 自動落下なし
        if (this.isPracticeMode) {
            return;
        }
        
        // AIモードの処理
        if (this.isAIMode && this.gameState === GAME_STATES.PLAYING && this.currentPiece !== null) {
            this.updateAI(deltaTime);
            return;  // AIモードでは通常の落下処理をスキップ
        }
        
        // 通常プレイ中の落下処理
        if (this.gameState === GAME_STATES.PLAYING && this.currentPiece !== null) {
            const dropInterval = Math.max(200, 700 - (this.level - 1) * 50);
            this.dropTimer += deltaTime;
            
            if (this.dropTimer >= dropInterval) {
                this.dropTimer = 0;
                this.moveDown(false);
            }
        }
    }
    
    // AI更新処理
    updateAI(deltaTime) {
        this.aiMoveTimer += deltaTime;
        
        // 一定間隔でAIの動作を実行
        if (this.aiMoveTimer >= this.aiMoveInterval) {
            this.aiMoveTimer = 0;
            
            if (this.aiMoveQueue.length > 0) {
                // キューから次の動作を取り出して実行
                const move = this.aiMoveQueue.shift();
                this.executeAIMove(move);
            } else {
                // キューが空なら次の手を計画
                this.planAIMove();
            }
        }
    }
    
    // AIの次の手を計画
    planAIMove() {
        if (!this.ai || !this.currentPiece) {
            return;
        }
        
        const bestMove = this.ai.findBestMove();
        if (bestMove) {
            this.aiMoveQueue = this.ai.generateMoveQueue(bestMove);
        } else {
            // 最善手が見つからない場合はとりあえずドロップ
            this.aiMoveQueue = ['drop'];
        }
    }
    
    // AIの動作を実行
    executeAIMove(move) {
        if (!this.currentPiece) {
            return;
        }
        
        switch (move) {
            case 'left':
                this.moveLeftInternal();
                break;
            case 'right':
                this.moveRightInternal();
                break;
            case 'rotate':
                this.rotateInternal();
                break;
            case 'drop':
                this.hardDropInternal();
                break;
        }
    }
    
    // AI用の内部移動メソッド（ガード条件なし）
    moveLeftInternal() {
        if (!this.currentPiece) return;
        if (!this.checkCollision(this.currentPiece, -1, 0)) {
            this.currentPiece.position.x--;
            this.lastMoveWasRotation = false;
        }
    }
    
    moveRightInternal() {
        if (!this.currentPiece) return;
        if (!this.checkCollision(this.currentPiece, 1, 0)) {
            this.currentPiece.position.x++;
            this.lastMoveWasRotation = false;
        }
    }
    
    rotateInternal() {
        if (!this.currentPiece) return;
        
        const rotated = this.currentPiece.rotate();
        
        if (!this.checkCollision(rotated, 0, 0)) {
            this.currentPiece = rotated;
            this.lastMoveWasRotation = true;
            return;
        }

        // 壁キック
        const kickTests = [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1]];
        for (const [kickX, kickY] of kickTests) {
            const kicked = rotated.clone();
            kicked.position.x += kickX;
            kicked.position.y += kickY;

            if (!this.checkCollision(kicked, 0, 0)) {
                this.currentPiece = kicked;
                this.lastMoveWasRotation = true;
                return;
            }
        }
    }
    
    hardDropInternal() {
        if (!this.currentPiece) return;
        
        while (!this.checkCollision(this.currentPiece, 0, 1)) {
            this.currentPiece.position.y++;
        }
        this.lastMoveWasRotation = false;
        this.lockPiece();
    }

    // ===========================================
    // ピース操作
    // ===========================================
    spawnNewPiece() {
        if (this.isGameOver) {
            return;
        }
        
        // おじゃまライン追加（バトルモード）
        if (this.pendingGarbage > 0) {
            this.addGarbageLines(this.pendingGarbage);
            this.pendingGarbage = 0;
        }

        const newPiece = new Tetromino(this.nextPieceType);
        this.nextPieceType = this.getNextPieceFromBag();
        this.drawNext();

        if (this.checkCollision(newPiece, 0, 0)) {
            this.triggerGameOver();
        } else {
            this.currentPiece = newPiece;
            this.gameState = GAME_STATES.PLAYING;
            
            // 練習モード: Undo用に状態保存
            if (this.isPracticeMode) {
                this.saveStateForUndo();
            }
            
            // AIモードの場合は新しいピースの手を計画
            if (this.isAIMode && this.ai) {
                this.aiMoveQueue = [];
                this.planAIMove();
            }
        }
    }
    
    // 練習モード用: Undo保存
    saveStateForUndo() {
        const state = {
            board: this.board.map(row => [...row]),
            currentPiece: this.currentPiece ? this.currentPiece.clone() : null,
            nextPieceType: this.nextPieceType,
            pieceBag: [...this.pieceBag],
            score: this.score,
            level: this.level,
            linesCleared: this.linesCleared
        };
        this.undoHistory.push(state);
        if (this.undoHistory.length > this.maxUndoHistory) {
            this.undoHistory.shift();
        }
    }
    
    // 練習モード用: Undo実行
    undo() {
        if (!this.isPracticeMode || this.undoHistory.length === 0) {
            return false;
        }
        const state = this.undoHistory.pop();
        this.board = state.board;
        this.currentPiece = state.currentPiece;
        this.nextPieceType = state.nextPieceType;
        this.pieceBag = state.pieceBag;
        this.score = state.score;
        this.level = state.level;
        this.linesCleared = state.linesCleared;
        this.updateDisplay();
        this.drawNext();
        return true;
    }
    
    // バトルモード用: おじゃまライン追加
    addGarbageLines(count) {
        // 既存のボードを上にシフト
        for (let i = 0; i < count; i++) {
            this.board.shift();
        }
        
        // 今回追加するブロックの穴の位置を1つ決める（同じ攻撃で来たゴミは穴が揃う）
        const holeIndex = Math.floor(Math.random() * BOARD_WIDTH);
        
        for (let i = 0; i < count; i++) {
            const garbageLine = Array(BOARD_WIDTH).fill('#888888');
            garbageLine[holeIndex] = null;
            this.board.push(garbageLine);
        }
    }
    
    // バトルモード用: おじゃまライン受信
    receiveGarbage(count) {
        this.pendingGarbage += count;
    }

    checkCollision(piece, offsetX, offsetY) {
        if (!piece || !piece.shape) {
            return true;
        }
        
        for (let i = 0; i < piece.shape.length; i++) {
            for (let j = 0; j < piece.shape[i].length; j++) {
                if (piece.shape[i][j] === 1) {
                    const x = piece.position.x + j + offsetX;
                    const y = piece.position.y + i + offsetY;
                    const boardY = y + BUFFER_HEIGHT;

                    // 左右の壁・底との衝突
                    if (x < 0 || x >= BOARD_WIDTH || boardY >= TOTAL_HEIGHT) {
                        return true;
                    }

                    // バッファより上は衝突なし（スポーン時のみ発生）
                    if (boardY < 0) {
                        continue;
                    }

                    // 既存ブロックとの衝突
                    if (this.board[boardY] && this.board[boardY][x] !== null) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    moveLeft() {
        // AIモードでは人間の操作を無効化
        if (this.isAIMode) return;
        if (!this.currentPiece || this.isPaused || this.isGameOver || this.gameState !== GAME_STATES.PLAYING) {
            return;
        }

        if (!this.checkCollision(this.currentPiece, -1, 0)) {
            this.currentPiece.position.x--;
            this.lastMoveWasRotation = false;
        }
    }

    moveRight() {
        // AIモードでは人間の操作を無効化
        if (this.isAIMode) return;
        if (!this.currentPiece || this.isPaused || this.isGameOver || this.gameState !== GAME_STATES.PLAYING) {
            return;
        }

        if (!this.checkCollision(this.currentPiece, 1, 0)) {
            this.currentPiece.position.x++;
            this.lastMoveWasRotation = false;
        }
    }

    rotate() {
        // AIモードでは人間の操作を無効化
        if (this.isAIMode) return;
        if (!this.currentPiece || this.isPaused || this.isGameOver || this.gameState !== GAME_STATES.PLAYING) {
            return;
        }

        const rotated = this.currentPiece.rotate();
        
        if (!this.checkCollision(rotated, 0, 0)) {
            this.currentPiece = rotated;
            this.lastMoveWasRotation = true;
            return;
        }

        // Super Rotation System (SRS) - 壁キック
        const kickTests = [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1]];

        for (const [kickX, kickY] of kickTests) {
            const kicked = rotated.clone();
            kicked.position.x += kickX;
            kicked.position.y += kickY;

            if (!this.checkCollision(kicked, 0, 0)) {
                this.currentPiece = kicked;
                this.lastMoveWasRotation = true;
                return;
            }
        }
    }

    hardDrop() {
        // AIモードでは人間の操作を無効化
        if (this.isAIMode) return;
        if (!this.currentPiece || this.isPaused || this.isGameOver || this.gameState !== GAME_STATES.PLAYING) {
            return;
        }

        while (!this.checkCollision(this.currentPiece, 0, 1)) {
            this.currentPiece.position.y++;
        }
        this.lastMoveWasRotation = false;
        this.lockPiece();
    }

    moveDown(manual = false) {
        // AIモードでは人間の操作を無効化
        if (this.isAIMode && manual) return;
        if (!this.currentPiece || this.isGameOver || this.gameState !== GAME_STATES.PLAYING) {
            return;
        }

        if (!this.checkCollision(this.currentPiece, 0, 1)) {
            this.currentPiece.position.y++;
            if (manual) {
                this.lastMoveWasRotation = false;
            }
        } else {
            // 練習モードでは手動下キーでロックしない（ハードドロップのみでロック）
            if (this.isPracticeMode && manual) {
                return;
            }
            this.lockPiece();
        }
    }

    // ===========================================
    // ピース固定とライン消去
    // ===========================================
    lockPiece() {
        if (!this.currentPiece) {
            return;
        }

        const isTSpin = this.checkTSpin(this.currentPiece);
        let lockedInBuffer = false;

        // ボードにピースを固定
        for (let i = 0; i < this.currentPiece.shape.length; i++) {
            for (let j = 0; j < this.currentPiece.shape[i].length; j++) {
                if (this.currentPiece.shape[i][j] === 1) {
                    const x = this.currentPiece.position.x + j;
                    const y = this.currentPiece.position.y + i;
                    const boardY = y + BUFFER_HEIGHT;
                    
                    if (boardY >= 0 && boardY < TOTAL_HEIGHT && x >= 0 && x < BOARD_WIDTH) {
                        this.board[boardY][x] = this.currentPiece.color;
                        
                        // バッファ内に固定されたか判定（ロックアウト条件）
                        if (boardY < BUFFER_HEIGHT) {
                            lockedInBuffer = true;
                        }
                    }
                }
            }
        }

        this.currentPiece = null;
        this.lastMoveWasRotation = false;

        // ロックアウト: バッファ内にブロックが残った場合はゲームオーバー
        if (lockedInBuffer) {
            this.triggerGameOver();
            return;
        }

        this.processLineClear(isTSpin);
    }

    checkTSpin(piece) {
        if (piece.type !== 'T' || !this.lastMoveWasRotation) {
            return false;
        }

        const x = piece.position.x;
        const y = piece.position.y;
        const corners = [[x, y], [x + 2, y], [x, y + 2], [x + 2, y + 2]];
        let filledCorners = 0;

        for (const [cx, cy] of corners) {
            const boardY = cy + BUFFER_HEIGHT;
            
            // 壁・範囲外・既存ブロックはfilledとしてカウント
            if (cx < 0 || cx >= BOARD_WIDTH || boardY < 0 || boardY >= TOTAL_HEIGHT) {
                filledCorners++;
            } else if (this.board[boardY] && this.board[boardY][cx] !== null) {
                filledCorners++;
            }
        }

        return filledCorners >= 3;
    }

    processLineClear(isTSpin) {
        const linesToClear = [];

        // 表示領域のみラインクリア判定（バッファは対象外）
        for (let boardY = BUFFER_HEIGHT; boardY < TOTAL_HEIGHT; boardY++) {
            if (this.board[boardY].every(cell => cell !== null)) {
                linesToClear.push(boardY);
            }
        }

        if (linesToClear.length > 0) {
            this.gameState = GAME_STATES.LINE_CLEARING;
            this.lineClearData = {
                lines: linesToClear,
                isTSpin: isTSpin,
                count: linesToClear.length,
                frameCount: 0
            };
            this.flashingLines = linesToClear;
            this.flashCounter = 0;
        } else {
            // ライン消去なし → コンボリセット
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

        // 消去対象以外のラインを保持
        const newBoard = [];
        for (let boardY = 0; boardY < TOTAL_HEIGHT; boardY++) {
            if (!data.lines.includes(boardY)) {
                newBoard.push(this.board[boardY]);
            }
        }

        // 上部に空のラインを追加
        while (newBoard.length < TOTAL_HEIGHT) {
            newBoard.unshift(Array(BOARD_WIDTH).fill(null));
        }

        this.board = newBoard;

        // コンボカウント増加
        this.comboCount++;

        // スコア計算
        const scoreTable = { 1: 25, 2: 100, 3: 400, 4: 1600 };
        const lineScore = scoreTable[data.count] || 25;
        this.score += lineScore * (this.level + 1);
        
        // おじゃまライン計算（バトルモード）
        let garbageToSend = 0;
        let actionText = '';
        
        // 大技かどうか判定（テトリス または T-Spin）
        const isDifficult = (data.count === 4) || (data.isTSpin && data.count > 0);
        
        // Back-to-Backボーナス判定
        let btbBonus = 0;
        if (isDifficult) {
            if (this.isBackToBack) {
                btbBonus = 1;
                actionText = 'BtB ';
            }
            this.isBackToBack = true;
        } else if (data.count > 0) {
            // 通常消し（1~3ライン）でBtB途切れる
            this.isBackToBack = false;
        }
        
        // Tスピンボーナス
        if (data.isTSpin && data.count > 0) {
            const bonus = data.count * 400 * this.level;
            this.score += bonus;
            const spinTypes = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE' };
            actionText += `T-SPIN ${spinTypes[data.count] || ''}!`;
            
            // Tスピンのおじゃまライン: 2/4/6 + BtBボーナス
            garbageToSend = data.count * 2 + btbBonus;
        } else if (data.count === 4) {
            const bonus = 800 * this.level;
            this.score += bonus;
            actionText += 'TETRIS!';
            
            // テトリスは4ライン + BtBボーナス
            garbageToSend = 4 + btbBonus;
        } else if (data.count >= 2) {
            // 2ライン: 1, 3ライン: 2
            garbageToSend = data.count - 1;
        }
        
        // コンボボーナス（2コンボ目以降）
        if (this.comboCount >= 2) {
            const comboBonus = (this.comboCount - 1);
            garbageToSend += comboBonus;
            
            if (actionText) {
                actionText += ` ${this.comboCount} REN!`;
            } else {
                actionText = `${this.comboCount} REN!`;
            }
        }
        
        // バトルモード: 相殺とおじゃまライン送信
        if (this.isBattleMode && garbageToSend > 0) {
            // 相殺（オフセット）処理
            if (this.pendingGarbage > 0) {
                if (garbageToSend >= this.pendingGarbage) {
                    // 攻撃力の方が高い：おじゃまを全消去し、余りを相手に送る
                    garbageToSend -= this.pendingGarbage;
                    this.pendingGarbage = 0;
                    if (garbageToSend > 0) {
                        actionText = actionText ? `${actionText} 相殺→+${garbageToSend}` : `相殺→+${garbageToSend}`;
                    } else {
                        actionText = actionText ? `${actionText} 相殺!` : '相殺!';
                    }
                } else {
                    // おじゃまの方が多い：おじゃまを減らすだけで、相手には送らない
                    this.pendingGarbage -= garbageToSend;
                    garbageToSend = 0;
                    actionText = actionText ? `${actionText} 相殺!` : '相殺!';
                }
            }
            
            // 相殺しきれずに残った攻撃分があれば相手に送る
            if (garbageToSend > 0 && this.onGarbageSend) {
                this.onGarbageSend(garbageToSend);
            }
        }
        
        // アクション表示
        if (actionText) {
            this.showAction(actionText);
        }

        this.linesCleared += data.count;

        // レベルアップ
        const newLevel = Math.floor(this.linesCleared / 10) + 1;
        if (newLevel > this.level) {
            this.level = newLevel;
        }

        this.updateDisplay();

        // タイムアタック完了チェック
        if (this.targetLines !== null && this.targetLines !== Infinity && this.linesCleared >= this.targetLines) {
            this.completeTimeAttack();
            return;
        }

        // 状態リセットして次のピースを生成
        this.flashingLines = [];
        this.flashCounter = 0;
        this.lineClearData = null;
        this.gameState = GAME_STATES.PLAYING;
        this.spawnNewPiece();
    }

    // ===========================================
    // ゲーム終了処理
    // ===========================================
    triggerGameOver() {
        this.isGameOver = true;
        this.gameState = GAME_STATES.GAME_OVER;
        
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.stopTimer();
        
        // バトルモードではコールバック
        if (this.isBattleMode && this.onGameOver) {
            this.onGameOver();
            return;
        }
        
        // ノーマルモードはゲームオーバーでも記録保存
        if (this.mode === 'normal') {
            this.saveRecord();
        }
        this.showGameOver();
    }

    endSprintMode() {
        if (this.isGameOver) {
            return;
        }
        
        this.isGameOver = true;
        this.gameState = GAME_STATES.GAME_OVER;
        
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.stopTimer();
        
        this.saveRecord();
        this.showSprintComplete();
    }

    completeTimeAttack() {
        this.isGameOver = true;
        this.gameState = GAME_STATES.GAME_OVER;
        
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.stopTimer();
        
        this.saveRecord();
        this.showTimeAttackComplete();
    }

    saveRecord() {
        const records = JSON.parse(localStorage.getItem('tetrisRecords') || '{}');
        
        // AIモードの場合は別のキーに保存（例: normal_ai, sprint1m_ai）
        const recordKey = this.isAIMode ? `${this.mode}_ai` : this.mode;
        
        if (!records[recordKey]) {
            records[recordKey] = [];
        }

        const record = {
            mode: this.mode,
            isAI: this.isAIMode,
            date: new Date().toISOString()
        };

        if (this.mode === 'normal') {
            record.score = this.score;
        } else if (this.mode === 'sprint1m') {
            record.lines = this.linesCleared;
        } else {
            record.time = this.elapsedTime;
        }

        records[recordKey].push(record);
        records[recordKey].sort((a, b) => {
            if (this.mode === 'normal') {
                return b.score - a.score;
            } else if (this.mode === 'sprint1m') {
                return b.lines - a.lines;
            }
            return a.time - b.time;
        });
        records[recordKey] = records[recordKey].slice(0, 10);

        localStorage.setItem('tetrisRecords', JSON.stringify(records));
    }

    showGameOver() {
        const title = document.querySelector('.game-over-title');
        title.textContent = 'GAME OVER';
        title.style.color = '#ff0000';
        
        document.getElementById('finalScore').textContent = this.score.toLocaleString() + ' 点';
        document.getElementById('gameOverOverlay').classList.remove('hidden');
    }

    showSprintComplete() {
        const title = document.querySelector('.game-over-title');
        title.textContent = '時間切れ!';
        title.style.color = '#00ff00';
        
        document.getElementById('finalScore').textContent = `${this.linesCleared} ライン`;
        document.getElementById('gameOverOverlay').classList.remove('hidden');
    }

    showTimeAttackComplete() {
        const title = document.querySelector('.game-over-title');
        title.textContent = 'COMPLETE!';
        title.style.color = '#00ff00';
        
        const timeStr = this.formatTime(this.elapsedTime);
        document.getElementById('finalScore').textContent = timeStr;
        document.getElementById('gameOverOverlay').classList.remove('hidden');
    }

    formatTime(milliseconds) {
        const totalSeconds = milliseconds / 1000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const ms = Math.floor((totalSeconds % 1) * 1000);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    // ===========================================
    // 描画
    // ===========================================
    draw() {
        this.ctx.fillStyle = '#1e293b';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 背景描画後のコールバック（AI影描画用）
        if (this.onAfterBackgroundDraw) {
            this.onAfterBackgroundDraw(this.ctx, this.blockSize);
        }

        // 固定ブロックの描画（表示領域のみ）
        for (let screenY = 0; screenY < BOARD_HEIGHT; screenY++) {
            const boardY = screenY + BUFFER_HEIGHT;
            for (let x = 0; x < BOARD_WIDTH; x++) {
                if (this.board[boardY] && this.board[boardY][x]) {
                    // ライン消去エフェクト
                    if (this.gameState === GAME_STATES.LINE_CLEARING && 
                        this.flashingLines.includes(boardY) && 
                        this.flashCounter < 6) {
                        this.ctx.fillStyle = '#ffffff';
                        this.ctx.shadowBlur = 15;
                        this.ctx.shadowColor = '#ffffff';
                        this.ctx.fillRect(
                            x * this.blockSize,
                            screenY * this.blockSize,
                            this.blockSize,
                            this.blockSize
                        );
                        this.ctx.shadowBlur = 0;
                    } else {
                        this.drawBlock(x, screenY, this.board[boardY][x]);
                    }
                } else {
                    this.drawEmptyBlock(x, screenY);
                }
            }
        }
        
        if (this.gameState === GAME_STATES.LINE_CLEARING) {
            this.flashCounter++;
        }

        // ゴーストとカレントピースの描画
        if (this.currentPiece) {
            // ゴースト（落下位置プレビュー）
            const ghost = this.getGhostPosition();
            if (ghost) {
                for (let i = 0; i < ghost.shape.length; i++) {
                    for (let j = 0; j < ghost.shape[i].length; j++) {
                        if (ghost.shape[i][j] === 1) {
                            const x = ghost.position.x + j;
                            const y = ghost.position.y + i;
                            if (y >= 0) {
                                this.ctx.fillStyle = this.currentPiece.color + '40';
                                this.ctx.fillRect(
                                    x * this.blockSize,
                                    y * this.blockSize,
                                    this.blockSize,
                                    this.blockSize
                                );
                                this.ctx.strokeStyle = this.currentPiece.color + 'AA';
                                this.ctx.lineWidth = 2;
                                this.ctx.strokeRect(
                                    x * this.blockSize,
                                    y * this.blockSize,
                                    this.blockSize,
                                    this.blockSize
                                );
                            }
                        }
                    }
                }
            }

            // カレントピース
            for (let i = 0; i < this.currentPiece.shape.length; i++) {
                for (let j = 0; j < this.currentPiece.shape[i].length; j++) {
                    if (this.currentPiece.shape[i][j] === 1) {
                        const x = this.currentPiece.position.x + j;
                        const y = this.currentPiece.position.y + i;
                        if (y >= 0) {
                            this.drawBlock(x, y, this.currentPiece.color);
                        }
                    }
                }
            }
        }
        
        // おじゃまライン待機表示（バトルモード）
        if (this.pendingGarbage > 0) {
            this.ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            for (let i = 0; i < Math.min(this.pendingGarbage, BOARD_HEIGHT); i++) {
                this.ctx.fillRect(0, (BOARD_HEIGHT - 1 - i) * this.blockSize, 4, this.blockSize);
            }
        }
    }

    drawBlock(x, y, color) {
        this.ctx.shadowBlur = 3;
        this.ctx.shadowColor = color;
        
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
            x * this.blockSize,
            y * this.blockSize,
            this.blockSize,
            this.blockSize
        );
        
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        this.ctx.fillRect(
            x * this.blockSize + 2,
            y * this.blockSize + 2,
            this.blockSize - 4,
            this.blockSize - 4
        );
        
        this.ctx.shadowBlur = 0;
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
            x * this.blockSize,
            y * this.blockSize,
            this.blockSize,
            this.blockSize
        );
    }

    drawEmptyBlock(x, y) {
        this.ctx.fillStyle = 'rgba(71, 85, 105, 0.1)';
        this.ctx.fillRect(
            x * this.blockSize,
            y * this.blockSize,
            this.blockSize,
            this.blockSize
        );
        this.ctx.strokeStyle = 'rgba(71, 85, 105, 0.2)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
            x * this.blockSize,
            y * this.blockSize,
            this.blockSize,
            this.blockSize
        );
    }

    getGhostPosition() {
        if (!this.currentPiece) {
            return null;
        }

        const ghost = this.currentPiece.clone();
        while (!this.checkCollision(ghost, 0, 1)) {
            ghost.position.y++;
        }
        return ghost;
    }

    drawNext() {
        this.nextCtx.fillStyle = '#1e293b';
        this.nextCtx.fillRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);

        if (!this.nextPieceType) {
            return;
        }

        const nextPiece = new Tetromino(this.nextPieceType);
        const blockSize = 25;
        const shape = nextPiece.shape;
        
        const totalWidth = shape[0].length * blockSize;
        const totalHeight = shape.length * blockSize;
        const offsetX = (this.nextCanvas.width - totalWidth) / 2;
        const offsetY = (this.nextCanvas.height - totalHeight) / 2;

        for (let i = 0; i < shape.length; i++) {
            for (let j = 0; j < shape[i].length; j++) {
                if (shape[i][j] === 1) {
                    this.nextCtx.fillStyle = nextPiece.color;
                    this.nextCtx.fillRect(
                        offsetX + j * blockSize,
                        offsetY + i * blockSize,
                        blockSize,
                        blockSize
                    );
                    this.nextCtx.strokeStyle = '#000';
                    this.nextCtx.lineWidth = 2;
                    this.nextCtx.strokeRect(
                        offsetX + j * blockSize,
                        offsetY + i * blockSize,
                        blockSize,
                        blockSize
                    );
                }
            }
        }
    }

    showAction(text) {
        this.lastAction = text;
        const display = document.getElementById('actionDisplay');
        display.innerHTML = `<div class="action-text">${text}</div>`;

        setTimeout(() => {
            display.innerHTML = '';
        }, 3000);
    }

    updateDisplay() {
        document.getElementById('scoreDisplay').textContent = this.score.toLocaleString();
        document.getElementById('levelDisplay').textContent = this.level;
        document.getElementById('linesDisplay').textContent = this.linesCleared;
    }

    // ===========================================
    // ゲーム制御
    // ===========================================
    togglePause() {
        if (this.isGameOver) {
            return;
        }

        this.isPaused = !this.isPaused;
        const pauseOverlay = document.getElementById('pauseOverlay');
        const pauseButton = document.getElementById('pauseButton');

        if (this.isPaused) {
            this.pauseTimer();  // タイマーを一時停止
            pauseOverlay.classList.remove('hidden');
            pauseButton.textContent = '▶ 再開';
            pauseOverlay.onclick = () => this.togglePause();
        } else {
            this.resumeTimer();  // タイマーを再開
            pauseOverlay.classList.add('hidden');
            pauseButton.textContent = '⏸ 一時停止';
            pauseOverlay.onclick = null;
        }
    }

    goHome() {
        this.cleanup();
        
        document.getElementById('gameScreen').classList.add('hidden');
        document.getElementById('gameOverOverlay').classList.add('hidden');
        document.getElementById('pauseOverlay').classList.add('hidden');
        document.getElementById('buttonControls').classList.add('hidden');
        document.getElementById('homeScreen').classList.remove('hidden');
        
        loadBestRecords();
        showRanking('normal');
    }

    reset() {
        this.cleanup();
        this.initializeGameState();
        
        document.getElementById('gameOverOverlay').classList.add('hidden');
        document.getElementById('pauseOverlay').classList.add('hidden');
        document.getElementById('actionDisplay').innerHTML = '';
        document.getElementById('timeDisplay').textContent = '';
        
        this.init();
        this.updateDisplay();
        this.updateModeInfo();
    }

    cleanup() {
        this.stopTimer();
        
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
}

// ===========================================
// TetrisAI - 観戦用自動プレイAI
// ===========================================
class TetrisAI {
    constructor(game) {
        this.game = game;
        
        // 評価関数の重み（チューニング可能）
        this.weights = {
            height: -0.5,        // 高さペナルティ
            holes: -3.5,         // 穴ペナルティ（強め）
            bumpiness: -0.2,     // 凹凸ペナルティ
            linesCleared: 3.0,   // ライン消去ボーナス
            wellDepth: 0.1,      // 井戸（テトリス用の溝）ボーナス
            multipleWells: -10.0 // 複数井戸ペナルティ（強め）
        };
        
        // AI動作用
        this.currentMove = null;
        this.moveQueue = [];
        this.thinkingComplete = false;
    }

    // メイン: 最善手を探索
    findBestMove() {
        if (!this.game.currentPiece) {
            return null;
        }

        const piece = this.game.currentPiece;
        let bestScore = -Infinity;
        let bestMove = null;

        // 全回転状態を試す（0, 1, 2, 3回転）
        const rotations = this.getRotationCount(piece.type);
        
        for (let rotation = 0; rotation < rotations; rotation++) {
            const rotatedPiece = this.getRotatedPiece(piece, rotation);
            
            // 全x位置を試す
            const minX = -2;
            const maxX = BOARD_WIDTH + 2;
            
            for (let x = minX; x < maxX; x++) {
                const testPiece = this.clonePiece(rotatedPiece);
                testPiece.position.x = x;
                
                // この位置が有効か確認
                if (this.isValidPosition(testPiece)) {
                    // ハードドロップした位置を取得
                    const dropY = this.getDropPosition(testPiece);
                    testPiece.position.y = dropY;
                    
                    // この配置をシミュレーション
                    const simulatedBoard = this.simulatePlacement(testPiece);
                    const score = this.evaluateBoard(simulatedBoard);
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = {
                            rotation: rotation,
                            x: x,
                            y: dropY
                        };
                    }
                }
            }
        }

        return bestMove;
    }

    // ピースの回転数を取得（Oは1、Iは2、他は4）
    getRotationCount(type) {
        if (type === 'O') return 1;
        if (type === 'I' || type === 'S' || type === 'Z') return 2;
        return 4;
    }

    // ピースを指定回数回転
    getRotatedPiece(piece, rotations) {
        let rotated = this.clonePiece(piece);
        for (let i = 0; i < rotations; i++) {
            rotated = rotated.rotate();
        }
        return rotated;
    }

    // ピースをクローン
    clonePiece(piece) {
        const cloned = new Tetromino(piece.type);
        cloned.shape = JSON.parse(JSON.stringify(piece.shape));
        cloned.position = { ...piece.position };
        return cloned;
    }

    // 位置が有効か確認（ゲームのcheckCollisionを使用）
    isValidPosition(piece) {
        return !this.checkCollisionForAI(piece, 0, 0);
    }

    // AI用の衝突判定（ゲームのボードを参照）
    checkCollisionForAI(piece, offsetX, offsetY) {
        for (let i = 0; i < piece.shape.length; i++) {
            for (let j = 0; j < piece.shape[i].length; j++) {
                if (piece.shape[i][j] === 1) {
                    const x = piece.position.x + j + offsetX;
                    const y = piece.position.y + i + offsetY;
                    const boardY = y + BUFFER_HEIGHT;

                    if (x < 0 || x >= BOARD_WIDTH || boardY >= TOTAL_HEIGHT) {
                        return true;
                    }

                    if (boardY >= 0 && this.game.board[boardY] && this.game.board[boardY][x] !== null) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // ハードドロップした時のY座標を取得
    getDropPosition(piece) {
        const testPiece = this.clonePiece(piece);
        while (!this.checkCollisionForAI(testPiece, 0, 1)) {
            testPiece.position.y++;
        }
        return testPiece.position.y;
    }

    // 配置をシミュレーション（ボードのコピーを返す）
    simulatePlacement(piece) {
        // ボードをコピー
        const boardCopy = this.game.board.map(row => [...row]);
        
        // ピースを配置
        for (let i = 0; i < piece.shape.length; i++) {
            for (let j = 0; j < piece.shape[i].length; j++) {
                if (piece.shape[i][j] === 1) {
                    const x = piece.position.x + j;
                    const y = piece.position.y + i;
                    const boardY = y + BUFFER_HEIGHT;
                    
                    if (boardY >= 0 && boardY < TOTAL_HEIGHT && x >= 0 && x < BOARD_WIDTH) {
                        boardCopy[boardY][x] = piece.color;
                    }
                }
            }
        }
        
        // ライン消去をシミュレーション
        return this.simulateLineClear(boardCopy);
    }

    // ライン消去をシミュレーション
    simulateLineClear(board) {
        const newBoard = [];
        let linesCleared = 0;
        
        for (let y = 0; y < TOTAL_HEIGHT; y++) {
            if (!board[y].every(cell => cell !== null)) {
                newBoard.push(board[y]);
            } else {
                linesCleared++;
            }
        }
        
        while (newBoard.length < TOTAL_HEIGHT) {
            newBoard.unshift(Array(BOARD_WIDTH).fill(null));
        }
        
        newBoard.linesCleared = linesCleared;
        return newBoard;
    }

    // ボードを評価
    evaluateBoard(board) {
        const linesCleared = board.linesCleared || 0;
        const heights = this.getColumnHeights(board);
        const aggregateHeight = heights.reduce((a, b) => a + b, 0);
        const holes = this.countHoles(board, heights);
        const bumpiness = this.calculateBumpiness(heights);
        const { wellDepth, wellCount } = this.calculateWellInfo(heights);
        
        // 井戸が2個以上ある場合のペナルティ
        const multipleWellsPenalty = wellCount >= 2 ? (wellCount - 1) : 0;

        return (
            this.weights.height * aggregateHeight +
            this.weights.holes * holes +
            this.weights.bumpiness * bumpiness +
            this.weights.linesCleared * linesCleared * linesCleared + // 4ライン消しを優遇
            this.weights.wellDepth * wellDepth +
            this.weights.multipleWells * multipleWellsPenalty
        );
    }

    // 各列の高さを取得
    getColumnHeights(board) {
        const heights = [];
        for (let x = 0; x < BOARD_WIDTH; x++) {
            let height = 0;
            for (let y = 0; y < TOTAL_HEIGHT; y++) {
                if (board[y][x] !== null) {
                    height = TOTAL_HEIGHT - y;
                    break;
                }
            }
            heights.push(height);
        }
        return heights;
    }

    // 穴の数をカウント
    countHoles(board, heights) {
        let holes = 0;
        for (let x = 0; x < BOARD_WIDTH; x++) {
            let blockFound = false;
            for (let y = 0; y < TOTAL_HEIGHT; y++) {
                if (board[y][x] !== null) {
                    blockFound = true;
                } else if (blockFound) {
                    holes++;
                }
            }
        }
        return holes;
    }

    // 凹凸度を計算
    calculateBumpiness(heights) {
        let bumpiness = 0;
        for (let i = 0; i < heights.length - 1; i++) {
            bumpiness += Math.abs(heights[i] - heights[i + 1]);
        }
        return bumpiness;
    }

    // 井戸の情報を計算（深さと個数）
    calculateWellInfo(heights) {
        let wellDepth = 0;
        let wellCount = 0;
        
        for (let i = 0; i < heights.length; i++) {
            const leftHeight = i > 0 ? heights[i - 1] : Infinity;
            const rightHeight = i < heights.length - 1 ? heights[i + 1] : Infinity;
            const minNeighbor = Math.min(leftHeight, rightHeight);
            
            // 井戸の判定：両隣より低い列
            if (heights[i] < minNeighbor) {
                const depth = minNeighbor - heights[i];
                wellDepth += depth;
                
                // 深さ2以上を井戸としてカウント
                if (depth >= 2) {
                    wellCount++;
                }
            }
        }
        
        return { wellDepth, wellCount };
    }

    // 最善手へのムーブキューを生成
    generateMoveQueue(targetMove) {
        if (!targetMove || !this.game.currentPiece) {
            return [];
        }

        const moves = [];
        const currentPiece = this.game.currentPiece;

        // まず回転
        for (let i = 0; i < targetMove.rotation; i++) {
            moves.push('rotate');
        }

        // 次に横移動
        const currentX = currentPiece.position.x;
        const targetX = targetMove.x;
        const deltaX = targetX - currentX;
        
        if (deltaX < 0) {
            for (let i = 0; i < Math.abs(deltaX); i++) {
                moves.push('left');
            }
        } else if (deltaX > 0) {
            for (let i = 0; i < deltaX; i++) {
                moves.push('right');
            }
        }

        // 最後にハードドロップ
        moves.push('drop');

        return moves;
    }
}

// ===========================================
// グローバル変数と関数
// ===========================================
let game = null;
let controlMode = 'swipe';
let isAIModeEnabled = false;  // AIモードのグローバルフラグ

function toggleAIMode() {
    isAIModeEnabled = document.getElementById('aiModeToggle').checked;
    const desc = document.getElementById('aiModeDesc');
    
    if (isAIModeEnabled) {
        desc.textContent = 'ON - AIがプレイします';
        desc.classList.add('active');
    } else {
        desc.textContent = 'OFF - 自分でプレイ';
        desc.classList.remove('active');
    }
}

function toggleInfoModal() {
    const modal = document.getElementById('infoModal');
    modal.classList.toggle('hidden');
}

// モーダルの外側クリックで閉じる
document.addEventListener('click', (e) => {
    const modal = document.getElementById('infoModal');
    if (e.target === modal) {
        modal.classList.add('hidden');
    }
});

function setupGlobalControls() {
    // キーボード操作（バトルモードと通常モードを統合）
    document.addEventListener('keydown', (e) => {
        // バトルモードの場合
        if (battleManager && battleManager.isRunning) {
            if (battleManager.isPaused && e.key.toLowerCase() !== 'p') return;
            
            const pg = battleManager.playerGame;
            if (!pg || pg.isGameOver) return;
            
            switch(e.key) {
                case 'ArrowLeft': e.preventDefault(); pg.moveLeft(); break;
                case 'ArrowRight': e.preventDefault(); pg.moveRight(); break;
                case 'ArrowUp': e.preventDefault(); pg.rotate(); break;
                case 'ArrowDown': e.preventDefault(); pg.moveDown(true); break;
                case ' ': e.preventDefault(); pg.hardDrop(); break;
                case 'p': case 'P': e.preventDefault(); battleManager.togglePause(); break;
            }
            return;
        }
        
        // 通常モードの場合
        if (!game || game.isGameOver) {
            return;
        }

        switch(e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                game.moveLeft();
                break;
            case 'ArrowRight':
                e.preventDefault();
                game.moveRight();
                break;
            case 'ArrowUp':
                e.preventDefault();
                game.rotate();
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (!game.isPaused) {
                    game.moveDown(true);
                }
                break;
            case ' ':
                e.preventDefault();
                game.hardDrop();
                break;
            case 'p':
            case 'P':
                e.preventDefault();
                game.togglePause();
                break;
            case 'z':
            case 'Z':
                e.preventDefault();
                if (game.isPracticeMode) {
                    game.undo();
                }
                break;
        }
    });

    // タッチ操作
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    const minSwipeDistance = 30;
    const tapMaxDuration = 200;

    const canvas = document.getElementById('gameCanvas');
    
    canvas.addEventListener('touchstart', (e) => {
        // バトルモードまたは通常モードのゲームを取得
        const targetGame = (battleManager && battleManager.isRunning) ? battleManager.playerGame : game;
        if (!targetGame || targetGame.isGameOver || targetGame.isPaused) {
            return;
        }
        if (battleManager && battleManager.isPaused) {
            return;
        }
        
        e.preventDefault();
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        const targetGame = (battleManager && battleManager.isRunning) ? battleManager.playerGame : game;
        if (!targetGame || targetGame.isGameOver || targetGame.isPaused) {
            return;
        }
        if (battleManager && battleManager.isPaused) {
            return;
        }
        
        e.preventDefault();
        const touch = e.changedTouches[0];
        const touchEndX = touch.clientX;
        const touchEndY = touch.clientY;
        const touchDuration = Date.now() - touchStartTime;

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        if (absDeltaX < minSwipeDistance && absDeltaY < minSwipeDistance && touchDuration < tapMaxDuration) {
            targetGame.rotate();
            return;
        }

        if (absDeltaX > absDeltaY) {
            if (deltaX < 0) {
                targetGame.moveLeft();
            } else {
                targetGame.moveRight();
            }
        } else {
            if (deltaY < 0) {
                targetGame.hardDrop();
            } else {
                targetGame.moveDown(true);
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
    }, { passive: false });

    // UIボタン
    document.getElementById('pauseButton').addEventListener('click', () => {
        if (battleManager && battleManager.isRunning) {
            battleManager.togglePause();
        } else if (game) {
            game.togglePause();
        }
    });

    document.getElementById('restartButton').addEventListener('click', () => {
        if (battleManager && battleManager.isRunning) {
            if (confirm('リスタートしますか？')) {
                restartBattle();
            }
        } else if (game && confirm('ゲームをリスタートしますか？')) {
            game.reset();
        }
    });

    document.getElementById('resetButton').addEventListener('click', () => {
        if (battleManager) {
            if (confirm('ホーム画面に戻りますか？')) {
                goHomeFromBattle();
            }
        } else if (game && confirm('ホーム画面に戻りますか？')) {
            game.goHome();
        }
    });

    document.getElementById('homeButton').addEventListener('click', () => {
        if (battleManager) {
            goHomeFromBattle();
        } else if (game) {
            game.goHome();
        }
    });

    // ボタン操作（touchstartで即座に反応、clickはフォールバック）
    const getTargetGame = () => {
        if (battleManager && battleManager.isRunning) return battleManager.playerGame;
        return game;
    };
    
    const gameButtons = [
        { id: 'leftBtn', action: () => { const g = getTargetGame(); if (g && !g.isPaused && !g.isGameOver) g.moveLeft(); } },
        { id: 'rightBtn', action: () => { const g = getTargetGame(); if (g && !g.isPaused && !g.isGameOver) g.moveRight(); } },
        { id: 'centerBtn', action: () => { const g = getTargetGame(); if (g && !g.isPaused && !g.isGameOver) g.moveDown(true); } },
        { id: 'upBtn', action: () => { const g = getTargetGame(); if (g && !g.isPaused && !g.isGameOver) g.rotate(); } },
        { id: 'downBtn2', action: () => { const g = getTargetGame(); if (g && !g.isPaused && !g.isGameOver) g.hardDrop(); } }
    ];

    gameButtons.forEach(({ id, action }) => {
        const btn = document.getElementById(id);
        let touched = false;

        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touched = true;
            action();
        }, { passive: false });

        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
        }, { passive: false });

        // マウス用フォールバック（PCでも動作）
        btn.addEventListener('click', (e) => {
            if (!touched) {
                action();
            }
            touched = false;
        });
    });

    // 追加: 取り消しボタン
    document.getElementById('undoButton').addEventListener('click', () => {
        if (game && game.isPracticeMode) {
            game.undo();
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    setupGlobalControls();
});

function toggleControlMode() {
    const isButton = document.getElementById('controlToggle').checked;
    const buttonControls = document.getElementById('buttonControls');
    const swipeInstructions = document.getElementById('swipeInstructions');
    
    if (isButton) {
        controlMode = 'button';
        buttonControls.classList.remove('hidden');
        swipeInstructions.classList.add('hidden');
    } else {
        controlMode = 'swipe';
        buttonControls.classList.add('hidden');
        swipeInstructions.classList.remove('hidden');
    }
}

function startGame(mode) {
    if (game) {
        game.cleanup();
        game = null;
    }
    if (battleManager) {
        battleManager.cleanup();
        battleManager = null;
    }
    
    // AI盤面パネルを非表示
    const aiPanel = document.getElementById('aiGamePanel');
    if (aiPanel) aiPanel.classList.add('hidden');
    
    // AIゲージパネルを非表示
    const aiGaugePanel = document.getElementById('aiGaugePanel');
    if (aiGaugePanel) aiGaugePanel.classList.add('hidden');
    
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('gameOverOverlay').classList.add('hidden');
    document.getElementById('pauseOverlay').classList.add('hidden');
    
    // AIモードでない場合のみボタンコントロールを表示
    if (!isAIModeEnabled) {
        const isButton = document.getElementById('controlToggle').checked;
        if (isButton) {
            document.getElementById('buttonControls').classList.remove('hidden');
        }
    } else {
        // AIモードではボタンを非表示
        document.getElementById('buttonControls').classList.add('hidden');
    }
    
    // AIモードはグローバルフラグから取得
    game = new TetrisGame(mode, isAIModeEnabled);
}

function loadBestRecords() {
    const records = JSON.parse(localStorage.getItem('tetrisRecords') || '{}');
    
    if (records.normal && records.normal.length > 0) {
        document.getElementById('normalBest').textContent = `最高: ${records.normal[0].score.toLocaleString()} 点`;
    }
    
    if (records.sprint1m && records.sprint1m.length > 0) {
        document.getElementById('sprint1mBest').textContent = `最高: ${records.sprint1m[0].lines} ライン`;
    }
    
    ['time10', 'time20', 'time40', 'time100'].forEach(mode => {
        if (records[mode] && records[mode].length > 0) {
            const time = records[mode][0].time;
            const totalSeconds = time / 1000;
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = Math.floor(totalSeconds % 60);
            const ms = Math.floor((totalSeconds % 1) * 1000);
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
            document.getElementById(`${mode}Best`).textContent = `記録: ${timeStr}`;
        }
    });
}

// ランキング表示用のグローバル状態
let currentRankingMode = 'normal';
let currentRankingType = 'human';  // 'human' or 'ai'

function showRanking(mode, event) {
    currentRankingMode = mode;
    
    if (event && event.target) {
        document.querySelectorAll('.ranking-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        event.target.classList.add('active');
    }
    
    updateRankingList();
}

function toggleRankingType(type, event) {
    currentRankingType = type;
    
    if (event && event.target) {
        document.querySelectorAll('.ranking-subtab').forEach(tab => {
            tab.classList.remove('active');
        });
        event.target.classList.add('active');
    }
    
    updateRankingList();
}

function updateRankingList() {
    const records = JSON.parse(localStorage.getItem('tetrisRecords') || '{}');
    const rankingList = document.getElementById('rankingList');
    
    // AIの場合はキーにサフィックスを追加
    const recordKey = currentRankingType === 'ai' ? `${currentRankingMode}_ai` : currentRankingMode;
    
    if (!records[recordKey] || records[recordKey].length === 0) {
        const typeLabel = currentRankingType === 'ai' ? '🤖 AI' : '👤 人間';
        rankingList.innerHTML = `<div style="text-align:center; color:#888; padding:20px;">${typeLabel}の記録はまだありません</div>`;
        return;
    }
    
    rankingList.innerHTML = records[recordKey].map((record, index) => {
        const date = new Date(record.date);
        const dateStr = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}`;
        
        let displayValue = '';
        // recordKeyからベースのmodeを取得
        const baseMode = currentRankingMode;
        
        if (baseMode === 'normal') {
            displayValue = `${record.score.toLocaleString()} 点`;
        } else if (baseMode === 'sprint1m') {
            displayValue = `${record.lines} ライン`;
        } else {
            const totalSeconds = record.time / 1000;
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = Math.floor(totalSeconds % 60);
            const ms = Math.floor((totalSeconds % 1) * 1000);
            displayValue = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
        }
        
        return `
            <div class="ranking-item">
                <span class="rank">#${index + 1}</span>
                <span class="time">${displayValue}</span>
                <span class="date">${dateStr}</span>
            </div>
        `;
    }).join('');
}

function createStarField() {
    const container = document.getElementById('starsBackground');
    const starCount = 100;
    const lineCount = 15;
    const shootingStarCount = 3;

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDelay = Math.random() * 3 + 's';
        star.style.opacity = 0.3 + Math.random() * 0.5;
        container.appendChild(star);
    }

    const stars = container.querySelectorAll('.star');
    for (let i = 0; i < lineCount; i++) {
        const star1 = stars[Math.floor(Math.random() * stars.length)];
        const star2 = stars[Math.floor(Math.random() * stars.length)];
        
        if (star1 !== star2) {
            const x1 = parseFloat(star1.style.left);
            const y1 = parseFloat(star1.style.top);
            const x2 = parseFloat(star2.style.left);
            const y2 = parseFloat(star2.style.top);
            
            const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            
            if (distance < 20) {
                const line = document.createElement('div');
                line.className = 'constellation-line';
                line.style.left = x1 + '%';
                line.style.top = y1 + '%';
                line.style.width = distance + '%';
                
                const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                line.style.transform = `rotate(${angle}deg)`;
                
                container.appendChild(line);
            }
        }
    }

    for (let i = 0; i < shootingStarCount; i++) {
        const shootingStar = document.createElement('div');
        shootingStar.className = 'shooting-star';
        shootingStar.style.left = Math.random() * 80 + '%';
        shootingStar.style.top = Math.random() * 50 + '%';
        shootingStar.style.animationDelay = Math.random() * 10 + 's';
        shootingStar.style.animationDuration = (2 + Math.random() * 2) + 's';
        container.appendChild(shootingStar);
    }
}

// Service Worker登録
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('Service Worker registered:', registration);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    });
}

// グローバルスコープに公開
window.startGame = startGame;
window.toggleControlMode = toggleControlMode;
window.showRanking = showRanking;
window.toggleRankingType = toggleRankingType;
window.loadBestRecords = loadBestRecords;
window.toggleAIMode = toggleAIMode;
window.toggleInfoModal = toggleInfoModal;

// ===========================================
// AI対戦モード
// ===========================================
let battleManager = null;

class BattleManager {
    constructor(difficulty = 'normal', aiVsAi = false) {
        this.difficulty = difficulty;
        this.aiVsAi = aiVsAi;  // AI対AI対戦フラグ
        this.playerGame = null;
        this.aiGame = null;
        this.isRunning = false;
        this.isPaused = false;
        this.animationFrameId = null;
        this.lastUpdateTime = 0;
        this.isMobile = window.innerWidth <= 768;
    }
    
    start() {
        const playerBlockSize = this.isMobile ? 
            Math.min(Math.max(Math.floor((window.innerWidth - 120) / BOARD_WIDTH), 20), 30) : 20;
        const aiBlockSize = this.isMobile ? 10 : 20;
        
        // プレイヤー側（AI観戦モードならAI1）
        this.playerGame = new TetrisGame('battle', this.aiVsAi, {
            isBattle: true,
            canvasId: 'gameCanvas',
            nextCanvasId: 'nextCanvas',
            blockSize: playerBlockSize,
            onGameOver: () => this.handleGameEnd(),
            onGarbageSend: (lines) => this.aiGame.receiveGarbage(lines)
        });
        
        // AI側（常にAI2）
        this.aiGame = new TetrisGame('battle', true, {
            isBattle: true,
            canvasId: 'aiCanvas',
            nextCanvasId: 'aiNextCanvas',
            blockSize: aiBlockSize,
            onGameOver: () => this.handleGameEnd(),
            onGarbageSend: (lines) => this.playerGame.receiveGarbage(lines)
        });
        
        // AI速度設定（数字が大きいほど遅い＝弱い）
        const aiSpeeds = { easy: 400, normal: 300, hard: 200, hardest: 100, insane: 50 };
        
        // AI観戦モードの場合、プレイヤー側もAIとして動作
        if (this.aiVsAi) {
            // プレイヤー側（AI1）は標準速度（50ms）で固定
            this.playerGame.aiMoveInterval = 50;
            // AI側（AI2）も標準速度（50ms）で固定
            this.aiGame.aiMoveInterval = aiSpeeds[this.difficulty];
        } else {
            // 通常の対戦モードでは難易度に応じた速度
            this.aiGame.aiMoveInterval = aiSpeeds[this.difficulty];
        }
        
        // スマホの場合、プレイヤー盤面にAI影を描画するコールバックを設定
        if (this.isMobile) {
            this.playerGame.onAfterBackgroundDraw = (ctx, blockSize) => {
                this.drawAIShadow(ctx, blockSize);
            };
        }
        
        this.isRunning = true;
        this.lastUpdateTime = performance.now();
        this.gameLoop();
    }
    
    // スマホ用: プレイヤー盤面にAIの影を描画
    drawAIShadow(ctx, blockSize) {
        const aiBoard = this.aiGame.board;
        const aiPiece = this.aiGame.currentPiece;
        
        // AI盤面のブロックを影として描画
        for (let boardY = BUFFER_HEIGHT; boardY < TOTAL_HEIGHT; boardY++) {
            for (let x = 0; x < BOARD_WIDTH; x++) {
                if (aiBoard[boardY] && aiBoard[boardY][x] !== null) {
                    const y = boardY - BUFFER_HEIGHT;
                    ctx.fillStyle = 'rgba(255, 100, 100, 0.15)';
                    ctx.fillRect(
                        x * blockSize,
                        y * blockSize,
                        blockSize,
                        blockSize
                    );
                }
            }
        }
        
        // AIの現在のピースも影として描画
        if (aiPiece) {
            for (let i = 0; i < aiPiece.shape.length; i++) {
                for (let j = 0; j < aiPiece.shape[i].length; j++) {
                    if (aiPiece.shape[i][j] === 1) {
                        const x = aiPiece.position.x + j;
                        const y = aiPiece.position.y + i;
                        if (y >= 0) {
                            ctx.fillStyle = 'rgba(255, 100, 100, 0.25)';
                            ctx.fillRect(
                                x * blockSize,
                                y * blockSize,
                                blockSize,
                                blockSize
                            );
                        }
                    }
                }
            }
        }
    }
    
    gameLoop() {
        if (!this.isRunning) return;
        
        const now = performance.now();
        const delta = now - this.lastUpdateTime;
        this.lastUpdateTime = now;
        
        if (!this.isPaused) {
            this.playerGame.update(delta);
            this.aiGame.update(delta);
        }
        
        this.playerGame.draw();
        this.aiGame.draw();
        this.updateDisplay();
        
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }
    
    updateDisplay() {
        document.getElementById('scoreDisplay').textContent = this.playerGame.score.toLocaleString();
        document.getElementById('levelDisplay').textContent = this.playerGame.level;
        document.getElementById('linesDisplay').textContent = this.playerGame.linesCleared;
        
        const aiScore = document.getElementById('aiScoreDisplay');
        const aiLevel = document.getElementById('aiLevelDisplay');
        const aiLines = document.getElementById('aiLinesDisplay');
        if (aiScore) aiScore.textContent = this.aiGame.score.toLocaleString();
        if (aiLevel) aiLevel.textContent = this.aiGame.level;
        if (aiLines) aiLines.textContent = this.aiGame.linesCleared;
        
        // モバイル用AIゲージ更新
        const aiGaugeBar = document.getElementById('aiGaugeBar');
        const aiGaugeLines = document.getElementById('aiGaugeLines');
        if (aiGaugeBar && aiGaugeLines) {
            // AIの積み上げ高さを計算（一番高いブロックの位置）
            const aiHeight = this.getStackHeight(this.aiGame);
            const heightPercent = (aiHeight / BOARD_HEIGHT) * 100;
            aiGaugeBar.style.height = heightPercent + '%';
            aiGaugeLines.textContent = this.aiGame.linesCleared;
        }
    }
    
    // 盤面の積み上げ高さを取得
    getStackHeight(game) {
        for (let y = 0; y < TOTAL_HEIGHT; y++) {
            for (let x = 0; x < BOARD_WIDTH; x++) {
                if (game.board[y][x] !== null) {
                    return TOTAL_HEIGHT - y;
                }
            }
        }
        return 0;
    }
    
    handleGameEnd() {
        if (!this.playerGame.isGameOver && !this.aiGame.isGameOver) return;
        
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        let title, color;
        if (this.playerGame.isGameOver && this.aiGame.isGameOver) {
            title = 'DRAW'; 
            color = '#ffff00';
        } else if (this.playerGame.isGameOver) {
            // AI観戦モードの場合は「AI2 WIN!」
            title = this.aiVsAi ? '🤖 AI2 WIN!' : 'AI WIN!'; 
            color = '#ff0000';
        } else {
            // AI観戦モードの場合は「AI1 WIN!」
            title = this.aiVsAi ? '🤖 AI1 WIN!' : 'YOU WIN!'; 
            color = '#00ff00';
        }
        
        document.getElementById('battleResultTitle').textContent = title;
        document.getElementById('battleResultTitle').style.color = color;
        document.getElementById('battleResultOverlay').classList.remove('hidden');
    }
    
    togglePause() {
        this.isPaused = !this.isPaused;
        document.getElementById('battlePauseOverlay').classList.toggle('hidden', !this.isPaused);
    }
    
    cleanup() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.playerGame = null;
        this.aiGame = null;
    }
}

function startBattle(difficulty) {
    if (game) {
        game.cleanup();
        game = null;
    }
    if (battleManager) {
        battleManager.cleanup();
        battleManager = null;
    }
    
    hideBattleDialog();
    
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('battleResultOverlay').classList.add('hidden');
    document.getElementById('battlePauseOverlay').classList.add('hidden');
    document.getElementById('buttonControls').classList.add('hidden');
    
    // AI盤面パネルを表示
    const aiPanel = document.getElementById('aiGamePanel');
    if (aiPanel) aiPanel.classList.remove('hidden');
    
    // モバイル用AIゲージパネルを表示
    const aiGaugePanel = document.getElementById('aiGaugePanel');
    if (aiGaugePanel) aiGaugePanel.classList.remove('hidden');
    
    // モード表示
    const diffNames = { easy: 'Easy', normal: 'Normal', hard: 'Hard', hardest: 'Hardest', insane: 'Insane' };
    const modePrefix = isAIModeEnabled ? '🤖 AI vs AI' : '⚔️ AI対戦';
    document.getElementById('modeInfo').textContent = `${modePrefix} - ${diffNames[difficulty]}`;
    document.getElementById('timeDisplay').textContent = '';
    
    // AI観戦モードの場合は操作パネルを非表示
    if (isAIModeEnabled) {
        document.getElementById('controlTogglePanel').style.display = 'none';
    } else {
        document.getElementById('controlTogglePanel').style.display = 'block';
    }
    
    document.getElementById('restartButton').style.display = 'block';
    
    // ボタン操作の状態を反映（AI観戦モードでない場合のみ）
    if (!isAIModeEnabled) {
        const isButton = document.getElementById('controlToggle').checked;
        document.getElementById('buttonControls').classList.toggle('hidden', !isButton);
    }
    
    // AI観戦モードの場合は、両方AIで対戦
    battleManager = new BattleManager(difficulty, isAIModeEnabled);
    battleManager.start();
}

function restartBattle() {
    if (!battleManager) return;
    const diff = battleManager.difficulty;
    const aiVsAi = battleManager.aiVsAi;
    battleManager.cleanup();
    document.getElementById('battleResultOverlay').classList.add('hidden');
    battleManager = new BattleManager(diff, aiVsAi);
    battleManager.start();
}

function goHomeFromBattle() {
    if (battleManager) {
        battleManager.cleanup();
        battleManager = null;
    }
    
    const aiPanel = document.getElementById('aiGamePanel');
    if (aiPanel) aiPanel.classList.add('hidden');
    
    const aiGaugePanel = document.getElementById('aiGaugePanel');
    if (aiGaugePanel) aiGaugePanel.classList.add('hidden');
    
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('battleResultOverlay').classList.add('hidden');
    document.getElementById('battlePauseOverlay').classList.add('hidden');
    document.getElementById('homeScreen').classList.remove('hidden');
    document.getElementById('controlTogglePanel').style.display = 'block';
    loadBestRecords();
}

function showBattleDialog() {
    document.getElementById('battleDialog').classList.remove('hidden');
}

function hideBattleDialog() {
    document.getElementById('battleDialog').classList.add('hidden');
}

window.startBattle = startBattle;
window.restartBattle = restartBattle;
window.goHomeFromBattle = goHomeFromBattle;
window.showBattleDialog = showBattleDialog;
window.hideBattleDialog = hideBattleDialog;

// 初期化
window.addEventListener('load', () => {
    loadBestRecords();
    showRanking('normal');
    createStarField();
});
