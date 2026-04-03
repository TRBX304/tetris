// ===========================================
// Supabase設定
// ===========================================
const SUPABASE_URL = 'https://tbyixmuibbvhogirfbxa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRieWl4bXVpYmJ2aG9naXJmYnhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzA5MDgsImV4cCI6MjA5MDM0NjkwOH0.lqgZuq0GcfRewtuXzmZ6ClFIhsFI5ol-WipqRK8fsrU';

async function supabaseFetch(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || res.statusText);
    }
    return res.json();
}

// ===========================================
// シード付き乱数 (xorshift32)
// ===========================================
class SeededRandom {
    constructor(seed) {
        this.s = (seed >>> 0) || 1;
    }
    next() {
        this.s ^= this.s << 13;
        this.s ^= this.s >>> 17;
        this.s ^= this.s << 5;
        return (this.s >>> 0) / 0xFFFFFFFF;
    }
}

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
// 効果音システム
// ===========================================
class SoundManager {
    constructor() {
        this.audioContext = null;
        this.enabled = true;
        this.volume = 0.3;
    }
    
    init() {
        if (this.audioContext) return;
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('Web Audio API not supported');
            this.enabled = false;
        }
    }
    
    // 音量設定
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
    }
    
    // 有効/無効切り替え
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
    
    // 基本のビープ音生成
    playTone(frequency, duration, type = 'square', volumeMod = 1) {
        if (!this.enabled || !this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        
        const vol = this.volume * volumeMod;
        gainNode.gain.setValueAtTime(vol, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }
    
    // 移動音
    playMove() {
        this.playTone(200, 0.05, 'square', 0.3);
    }
    
    // 回転音
    playRotate() {
        this.playTone(300, 0.08, 'square', 0.4);
    }
    
    // ハードドロップ音
    playHardDrop() {
        if (!this.enabled || !this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(150, this.audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(50, this.audioContext.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(this.volume * 0.6, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.15);
    }
    
    // ライン消し音（ライン数に応じて変化）
    playLineClear(lineCount) {
        if (!this.enabled || !this.audioContext) return;
        
        const baseFreq = 400 + lineCount * 100;
        const notes = lineCount === 4 ? [1, 1.25, 1.5, 2] : [1, 1.25, 1.5];
        
        notes.forEach((mult, i) => {
            setTimeout(() => {
                this.playTone(baseFreq * mult, 0.15, 'square', 0.5);
            }, i * 80);
        });
    }
    
    // テトリス音（特別な音）
    playTetris() {
        if (!this.enabled || !this.audioContext) return;
        
        const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
            setTimeout(() => {
                this.playTone(freq, 0.2, 'square', 0.5);
            }, i * 100);
        });
    }
    
    // Tスピン音
    playTSpin() {
        if (!this.enabled || !this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(300, this.audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(600, this.audioContext.currentTime + 0.1);
        oscillator.frequency.exponentialRampToValueAtTime(900, this.audioContext.currentTime + 0.2);
        
        gainNode.gain.setValueAtTime(this.volume * 0.4, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.3);
    }
    
    // コンボ音
    playCombo(comboCount) {
        if (!this.enabled || !this.audioContext) return;
        
        const baseFreq = 300 + Math.min(comboCount, 10) * 50;
        this.playTone(baseFreq, 0.1, 'sine', 0.5);
        setTimeout(() => {
            this.playTone(baseFreq * 1.5, 0.1, 'sine', 0.4);
        }, 50);
    }
    
    // Back-to-Back音
    playBackToBack() {
        if (!this.enabled || !this.audioContext) return;
        
        setTimeout(() => this.playTone(600, 0.1, 'sine', 0.4), 0);
        setTimeout(() => this.playTone(800, 0.1, 'sine', 0.4), 80);
        setTimeout(() => this.playTone(1000, 0.15, 'sine', 0.5), 160);
    }
    
    // ゲームオーバー音
    playGameOver() {
        if (!this.enabled || !this.audioContext) return;
        
        const notes = [400, 350, 300, 200];
        notes.forEach((freq, i) => {
            setTimeout(() => {
                this.playTone(freq, 0.3, 'sawtooth', 0.4);
            }, i * 200);
        });
    }
    
    // 勝利音
    playWin() {
        if (!this.enabled || !this.audioContext) return;
        
        const notes = [523, 659, 784, 1047, 1047];
        notes.forEach((freq, i) => {
            setTimeout(() => {
                this.playTone(freq, 0.2, 'square', 0.5);
            }, i * 120);
        });
    }
    
    // おじゃまライン受信音
    playGarbageReceive() {
        if (!this.enabled || !this.audioContext) return;
        
        this.playTone(100, 0.15, 'sawtooth', 0.5);
        setTimeout(() => {
            this.playTone(80, 0.2, 'sawtooth', 0.4);
        }, 100);
    }
    
    // 相殺音
    playCounter() {
        if (!this.enabled || !this.audioContext) return;
        
        this.playTone(500, 0.1, 'square', 0.4);
        setTimeout(() => this.playTone(700, 0.1, 'square', 0.4), 60);
    }
}

// ===========================================
// BGMマネージャー（コロブチカ）
// ===========================================
class BGMManager {
    constructor() {
        this.audioContext = null;
        this.enabled = true;
        this.isPlaying = false;
        this.isPaused = false;
        this.bpm = 180;

        this.timeoutId = null;
        this.kickLoopTimeoutId = null;

        // ==================
        // パート設定
        // ==================
        
        // メロディ
        this.melodyConfig = {
            waveType: 'square',
            volume: 0.12
        };
        
        // ベース
        this.bassConfig = {
            waveType: 'sawtooth',
            volume: 0.12 * 0.9
        };
        
        // キック音の設定（共通）
        this.kickSoundConfig = {
            waveType: 'sine',
            startFreq: 150,     // 開始周波数
            endFreq: 30,        // 終了周波数
            freqDecay: 0.08,    // 周波数減衰時間
            gainDecay: 0.12,    // 音量減衰時間
            duration: 0.15      // 全体の長さ
        };
        
        // ベース連動キック
        this.kickConfig = {
            volume: 0.12 * 2.5
        };
        
        // 四分キック（独立ループ）
        this.kickLoopConfig = {
            volume: 0.12 * 1.5,
            interval: 1  // 1 = 四分音符, 0.5 = 八分音符
        };

        // ==================
        // インデックス管理
        // ==================
        this.noteIndex = 0;
        this.bassIndex = 0;
        this.bassRemainingBeats = 0;
        this.kickIndex = 0;
        this.kickRemainingBeats = 0;

        // ==================
        // 周波数テーブル
        // ==================
        this.noteFrequencies = {
            'C2':65.41,'C#2':69.30,'D2':73.42,'D#2':77.78,'E2':82.41,
            'F2':87.31,'F#2':92.50,'G2':98.00,'G#2':103.83,'A2':110.00,
            'A#2':116.54,'B2':123.47,
            'C3':130.81,'C#3':138.59,'D3':146.83,'D#3':155.56,'E3':164.81,
            'F3':174.61,'F#3':185.00,'G3':196.00,'G#3':207.65,'A3':220.00,
            'A#3':233.08,'B3':246.94,
            'C4':261.63,'C#4':277.18,'D4':293.66,'D#4':311.13,'E4':329.63,
            'F4':349.23,'F#4':369.99,'G4':392.00,'G#4':415.30,'A4':440.00,
            'A#4':466.16,'B4':493.88,
            'C5':523.25,'C#5':554.37,'D5':587.33,'D#5':622.25,'E5':659.25
        };

        // ==================
        // メロディデータ
        // ==================
        this.melody = [
            ['E4',1],['B3',0.5],['C4',0.5],['D4',1],['C4',0.5],['B3',0.5],
            ['A3',1],['A3',0.5],['C4',0.5],['E4',1],['D4',0.5],['C4',0.5],
            ['B3',1.5],['C4',0.5],['D4',1],['E4',1],['C4',1],['A3',1],['A3',1],['R',1],
            ['D4',1.5],['F4',0.5],['A4',1],['G4',0.5],['F4',0.5],
            ['E4',1.5],['C4',0.5],['E4',1],['D4',0.5],['C4',0.5],
            ['B3',1],['B3',0.5],['C4',0.5],['D4',1],['E4',1],['C4',1],['A3',1],['A3',1],['R',1],
            ['E4',2],['C4',2],['D4',2],['B3',2],['C4',2],['A3',2],['G#3',2],['B3',1],['R',1],
            ['E4',2],['C4',2],['D4',2],['B3',2],['C4',1],['E4',1],['A4',2],['G#4',2],['R',2]
        ];

        // ==================
        // ベースデータ
        // ==================
        this.bassLine = [
            ['A2',0.5],['E3',0.5],['A3',0.5],['E3',0.5],
            ['G2',0.5],['D3',0.5],['G3',0.5],['D3',0.5],
            ['F2',0.5],['C3',0.5],['F3',0.5],['C3',0.5],
            ['E2',0.5],['B2',0.5],['E3',0.5],['B2',0.5],
            ['A2',0.5],['E3',0.5],['A3',0.5],['E3',0.5],
            ['A2',0.5],['E3',0.5],['A3',0.5],['E3',0.5],
        ];

        // ==================
        // ベース連動キックデータ
        // ==================
        this.kickLine = [
            ['K', 0.5], ['K', 0.5], ['K', 0.5], ['K', 0.5],
            ['K', 0.5], ['K', 0.5], ['K', 0.5], ['K', 0.5],
        ];
    }

    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    beatToSec(b) {
        return (60 / this.bpm) * b;
    }

    playOsc(freq, dur, type, vol) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = type;
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        const now = this.audioContext.currentTime;
        gain.gain.setValueAtTime(vol, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + dur);

        osc.start(now);
        osc.stop(now + dur);
    }

    // キック音（周波数急降下）
    playKick(vol) {
        const cfg = this.kickSoundConfig;
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = cfg.waveType;
        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        const now = this.audioContext.currentTime;
        osc.frequency.setValueAtTime(cfg.startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(cfg.endFreq, now + cfg.freqDecay);

        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + cfg.gainDecay);

        osc.start(now);
        osc.stop(now + cfg.duration);
    }

    playNext() {
        if (!this.isPlaying || this.isPaused) return;

        const [note, beats] = this.melody[this.noteIndex];
        const dur = this.beatToSec(beats);

        // メロディ
        if (note !== 'R') {
            this.playOsc(
                this.noteFrequencies[note],
                dur * 0.85,
                this.melodyConfig.waveType,
                this.melodyConfig.volume
            );
        }

        // ベース処理
        if (this.bassRemainingBeats <= 0) {
            const [bn, bb] = this.bassLine[this.bassIndex];
            if (bn !== 'R') {
                this.playOsc(
                    this.noteFrequencies[bn],
                    this.beatToSec(bb),
                    this.bassConfig.waveType,
                    this.bassConfig.volume
                );
            }
            this.bassRemainingBeats = bb;
            this.bassIndex = (this.bassIndex + 1) % this.bassLine.length;
        }

        // ベース連動キック処理
        if (this.kickRemainingBeats <= 0) {
            const [kn, kb] = this.kickLine[this.kickIndex];
            if (kn === 'K') {
                this.playKick(this.kickConfig.volume);
            }
            this.kickRemainingBeats = kb;
            this.kickIndex = (this.kickIndex + 1) % this.kickLine.length;
        }

        this.bassRemainingBeats -= beats;
        this.kickRemainingBeats -= beats;
        this.noteIndex = (this.noteIndex + 1) % this.melody.length;

        this.timeoutId = setTimeout(() => this.playNext(), dur * 1000);
    }

    play() {
        if (this.isPlaying) return;
        this.init();
        this.audioContext.resume();

        this.isPlaying = true;
        this.isPaused = false;
        this.noteIndex = 0;
        this.bassIndex = 0;
        this.bassRemainingBeats = 0;
        this.kickIndex = 0;
        this.kickRemainingBeats = 0;

        this.playNext();
        this.playKickLoop();
    }

    // 独立キックループ
    playKickLoop() {
        if (!this.isPlaying || this.isPaused) return;
        
        this.playKick(this.kickLoopConfig.volume);
        
        this.kickLoopTimeoutId = setTimeout(
            () => this.playKickLoop(),
            this.beatToSec(this.kickLoopConfig.interval) * 1000
        );
    }

    pause() {
        this.isPaused = true;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.kickLoopTimeoutId) {
            clearTimeout(this.kickLoopTimeoutId);
            this.kickLoopTimeoutId = null;
        }
    }

    resume() {
        if (!this.isPlaying || !this.isPaused) return;
        this.isPaused = false;
        this.playNext();
        this.playKickLoop();  // キックループも再開
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.kickLoopTimeoutId) {
            clearTimeout(this.kickLoopTimeoutId);
            this.kickLoopTimeoutId = null;
        }
    }
}


// グローバル効果音マネージャー
const soundManager = new SoundManager();

// グローバルBGMマネージャー
const bgmManager = new BGMManager();

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
        this.holdCanvasId = options.holdCanvasId || 'holdCanvas';
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
        
        // ホールドキャンバス
        this.holdCanvas = document.getElementById(this.holdCanvasId);
        this.holdCtx = this.holdCanvas ? this.holdCanvas.getContext('2d') : null;

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
        
        // ホールド機能
        this.holdPieceType = null;
        
        // 練習モード用Undo
        this.undoHistory = [];
        this.maxUndoHistory = 20;

        // 世界ランキング用: シード・操作ログ・セッション
        this.seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
        this.rng = new SeededRandom(this.seed);
        this.opLog = [];           // 操作ログバッファ
        this.sessionToken = null;  // Supabaseセッションtoken
        this.logFlushTimer = null; // バッファflushタイマー
        this._logSeq = 0;          // バッチ連番
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

        // 世界ランキング対象モードのみセッション開始
        if (!this.isAIMode && !this.isBattleMode && !this.isPracticeMode) {
            this._startSession();
            // 2秒ごとに操作ログをflush
            this.logFlushTimer = setInterval(() => this._flushLog(), 2000);
        }
    }

    // ==========================================
    // 世界ランキング: セッション・ログ管理
    // ==========================================
    async _startSession() {
        try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/session-start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ seed: this.seed, mode: this.mode })
            });
            const data = await res.json();
            this.sessionToken = data.session_token;
        } catch (e) {
            console.warn('session-start failed (offline?)', e);
        }
    }

    _logOp(type, payload = {}) {
        // AIモード・バトル・練習は記録不要
        if (this.isAIMode || this.isBattleMode || this.isPracticeMode) return;
        // sessionTokenがなくてもバッファに溜めておく（後でflush時に送られる）
        this.opLog.push({ t: type, ts: performance.now() | 0, ...payload });
    }

    async _flushLog() {
        if (!this.sessionToken || this.opLog.length === 0) return;
        const batch = this.opLog.splice(0);
        const seq = this._logSeq;
        try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/log-ops`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ session_token: this.sessionToken, ops: batch, seq })
            });
            if (res.ok) {
                this._logSeq++; // 成功したら次のseqに進む
            } else {
                this.opLog.unshift(...batch); // 失敗したらキューに戻す
            }
        } catch (e) {
            this.opLog.unshift(...batch); // 通信エラーもキューに戻す
        }
    }

    // クリア時: 全バッチ送信完了を保証
    async _flushAll() {
        const MAX_ATTEMPTS = 5;   // 最大試行回数
        const RETRY_WAIT = 1000;  // 失敗時の待機ms

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            // 溜まっているバッファを全部送り切るまでループ
            while (this.opLog.length > 0) {
                await this._flushLog();
                if (this.opLog.length > 0) {
                    // まだ残っている = 送信失敗 → 待ってリトライ
                    await new Promise(r => setTimeout(r, RETRY_WAIT));
                    break; // whileを抜けてattemptループで再試行
                }
            }
            if (this.opLog.length === 0) return true; // 全部送れた
        }
        return false; // 最大試行回数を超えた
    }

    async _verifyAndSave(playerName) {
        // 全バッチ送信完了を保証してからverifyを呼ぶ
        const flushed = await this._flushAll();
        if (!flushed) {
            return { ok: false, error: 'flush_failed' };
        }
        try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-and-save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({
                    session_token: this.sessionToken,
                    player_name: playerName
                })
            });
            const data = await res.json();
            return data;
        } catch (e) {
            return { ok: false, error: 'network' };
        }
    }

    fillPieceBag() {
        const types = Object.keys(TETROMINO_TYPES);
        this.pieceBag = [...types];
        // Fisher-Yatesシャッフル（シード付き乱数を使用）
        for (let i = this.pieceBag.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng.next() * (i + 1));
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
        
        soundManager.playGarbageReceive();
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
            this._logOp('L');
            soundManager.playMove();
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
            this._logOp('R');
            soundManager.playMove();
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
            this._logOp('U');
            soundManager.playRotate();
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
                this._logOp('U');
                soundManager.playRotate();
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
        soundManager.playHardDrop();
        this._logOp('D');
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

    // ホールド機能
    hold() {
        if (this.isAIMode) return;
        if (!this.currentPiece || this.isPaused || this.isGameOver || this.gameState !== GAME_STATES.PLAYING) {
            return;
        }
        
        const currentType = this.currentPiece.type;
        
        if (this.holdPieceType === null) {
            // ホールドが空の場合：現在のピースをホールドして新しいピースを生成
            this.holdPieceType = currentType;
            this.spawnNewPiece();
        } else {
            // ホールドにピースがある場合：交換
            const holdType = this.holdPieceType;
            this.holdPieceType = currentType;
            this.currentPiece = new Tetromino(holdType);
        }
        
        this.lastMoveWasRotation = false;
        this.drawHold();
        soundManager.playRotate();  // ホールド時も回転音を鳴らす
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

        // 全消し（パーフェクトクリア）判定
        const isPerfectClear = this.board.every(row => row.every(cell => cell === null));

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
                soundManager.playBackToBack();
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
            soundManager.playTSpin();
        } else if (data.count === 4) {
            const bonus = 800 * this.level;
            this.score += bonus;
            actionText += 'TETRIS!';
            
            // テトリスは4ライン + BtBボーナス
            garbageToSend = 4 + btbBonus;
            soundManager.playTetris();
        } else if (data.count >= 2) {
            // 2ライン: 1, 3ライン: 2
            garbageToSend = data.count - 1;
            soundManager.playLineClear(data.count);
        } else if (data.count === 1) {
            soundManager.playLineClear(1);
        }
        
        // 全消しボーナス
        if (isPerfectClear) {
            const pcBonus = 3000 * this.level;
            this.score += pcBonus;
            actionText = 'PERFECT CLEAR!' + (actionText ? ' ' + actionText : '');
            garbageToSend = 10;  // 全消しは10ライン送る
            soundManager.playWin();  // 特別な音
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
            soundManager.playCombo(this.comboCount);
        }
        
        // ダメージ数字演出用に消去ライン位置を保存
        const clearedLineY = data.lines.length > 0 ? 
            Math.min(...data.lines) - BUFFER_HEIGHT : 10;
        
        // バトルモード: 相殺とおじゃまライン送信
        let actualDamage = 0;  // 実際に送ったダメージ
        if (this.isBattleMode && garbageToSend > 0) {
            // 相殺（オフセット）処理
            if (this.pendingGarbage > 0) {
                soundManager.playCounter();
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
                actualDamage = garbageToSend;
                this.onGarbageSend(garbageToSend);
            }
        }
        
        // アクション表示
        if (actionText) {
            this.showAction(actionText);
        }
        
        // ダメージ数字演出（バトルモードで攻撃が通った時）
        if (this.isBattleMode && actualDamage > 0) {
            this.showDamageNumber(actualDamage, clearedLineY);
        }

        this.linesCleared += data.count;

        // 世界ランキング用: ライン消去ログ（sprint1mのスコア集計に使用）
        if (data.count > 0) {
            this._logOp('LINE', { count: data.count });
        }

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
        
        bgmManager.stop();  // BGM停止
        soundManager.playGameOver();
        
        // ノーマルモードはゲームオーバーでも記録保存
        if (this.mode === 'normal') {
            this._logOp('SCORE', { score: this.score }); // 世界ランキング用スコア送信
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
        
        bgmManager.stop();  // BGM停止
        this._logOp('LINES', { lines: this.linesCleared }); // 世界ランキング用
        this._logOp('TIME', { time_ms: this.elapsedTime }); // クライアントタイマーの値
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
        
        bgmManager.stop();  // BGM停止
        soundManager.playWin();
        
        this._logOp('TIME', { time_ms: this.elapsedTime }); // クライアントタイマーの値
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
        this._showRankingRegisterButton(false); // normalはゲームオーバーでも登録可
        document.getElementById('gameOverOverlay').classList.remove('hidden');
    }

    showSprintComplete() {
        const title = document.querySelector('.game-over-title');
        title.textContent = '時間切れ!';
        title.style.color = '#00ff00';
        
        document.getElementById('finalScore').textContent = `${this.linesCleared} ライン`;
        this._showRankingRegisterButton(true);
        document.getElementById('gameOverOverlay').classList.remove('hidden');
    }

    showTimeAttackComplete() {
        const title = document.querySelector('.game-over-title');
        title.textContent = 'COMPLETE!';
        title.style.color = '#00ff00';
        
        const timeStr = this.formatTime(this.elapsedTime);
        document.getElementById('finalScore').textContent = timeStr;
        this._showRankingRegisterButton(true);
        document.getElementById('gameOverOverlay').classList.remove('hidden');
    }

    _showRankingRegisterButton(show) {
        const area = document.getElementById('worldRankingRegisterArea');
        if (!area) return;
        // AIモード・バトル・練習は登録不可
        if (this.isAIMode || this.isBattleMode || this.isPracticeMode || !this.sessionToken) {
            area.classList.add('hidden');
            return;
        }
        if (show) {
            area.classList.remove('hidden');
        } else {
            // normalのゲームオーバーは登録可（スコアがあれば）
            if (this.mode === 'normal' && this.score > 0) {
                area.classList.remove('hidden');
            } else {
                area.classList.add('hidden');
            }
        }
        // 登録済みフラグをリセット
        const btn = document.getElementById('worldRankingRegisterBtn');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🌍 世界ランキングに登録';
        }
        const nameInput = document.getElementById('worldRankingName');
        if (nameInput) nameInput.value = localStorage.getItem('lastPlayerName') || '';
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
        
        // ダメージ数字演出
        this.drawDamageNumbers();
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

    drawHold() {
        if (!this.holdCtx) return;
        
        this.holdCtx.fillStyle = '#1e293b';
        this.holdCtx.fillRect(0, 0, this.holdCanvas.width, this.holdCanvas.height);

        if (!this.holdPieceType) {
            return;
        }

        const holdPiece = new Tetromino(this.holdPieceType);
        const shape = holdPiece.shape;
        
        // キャンバスサイズに合わせてブロックサイズを計算
        const maxBlockWidth = (this.holdCanvas.width - 10) / shape[0].length;
        const maxBlockHeight = (this.holdCanvas.height - 10) / shape.length;
        const blockSize = Math.min(maxBlockWidth, maxBlockHeight, 25);
        
        const totalWidth = shape[0].length * blockSize;
        const totalHeight = shape.length * blockSize;
        const offsetX = (this.holdCanvas.width - totalWidth) / 2;
        const offsetY = (this.holdCanvas.height - totalHeight) / 2;

        for (let i = 0; i < shape.length; i++) {
            for (let j = 0; j < shape[i].length; j++) {
                if (shape[i][j] === 1) {
                    this.holdCtx.fillStyle = holdPiece.color;
                    this.holdCtx.fillRect(
                        offsetX + j * blockSize,
                        offsetY + i * blockSize,
                        blockSize,
                        blockSize
                    );
                    this.holdCtx.strokeStyle = '#000';
                    this.holdCtx.lineWidth = 2;
                    this.holdCtx.strokeRect(
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

    // ダメージ数字演出（浮かび上がって消える）
    showDamageNumber(damage, lineY) {
        // キャンバス上の位置を計算
        const x = this.canvas.width / 2;
        const y = lineY * this.blockSize;
        
        // ダメージ数字の状態を保存
        this.damageNumbers = this.damageNumbers || [];
        this.damageNumbers.push({
            value: damage,
            x: x,
            y: y,
            opacity: 1,
            offsetY: 0,
            startTime: performance.now()
        });
    }

    // ダメージ数字を描画（drawメソッドから呼ばれる）
    drawDamageNumbers() {
        if (!this.damageNumbers || this.damageNumbers.length === 0) return;
        
        const now = performance.now();
        const duration = 1000;  // 1秒で消える
        
        this.damageNumbers = this.damageNumbers.filter(dmg => {
            const elapsed = now - dmg.startTime;
            if (elapsed > duration) return false;
            
            const progress = elapsed / duration;
            dmg.opacity = 1 - progress;
            dmg.offsetY = -50 * progress;  // 上に50px浮かぶ
            
            // 描画
            this.ctx.save();
            this.ctx.font = `bold ${this.blockSize * 1.5}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            // 影
            this.ctx.fillStyle = `rgba(0, 0, 0, ${dmg.opacity * 0.5})`;
            this.ctx.fillText(`+${dmg.value}`, dmg.x + 2, dmg.y + dmg.offsetY + 2);
            
            // 本体（赤〜オレンジのグラデーション風）
            this.ctx.fillStyle = `rgba(255, ${100 + dmg.value * 10}, 50, ${dmg.opacity})`;
            this.ctx.fillText(`+${dmg.value}`, dmg.x, dmg.y + dmg.offsetY);
            
            this.ctx.restore();
            
            return true;
        });
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
            bgmManager.pause();  // BGM一時停止
            pauseOverlay.classList.remove('hidden');
            pauseButton.textContent = '▶ 再開';
            pauseOverlay.onclick = () => this.togglePause();
        } else {
            this.resumeTimer();  // タイマーを再開
            bgmManager.resume();  // BGM再開
            pauseOverlay.classList.add('hidden');
            pauseButton.textContent = '⏸ 一時停止';
            pauseOverlay.onclick = null;
        }
    }

    goHome() {
        this.cleanup();
        bgmManager.stop();  // BGM停止
        
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
        
        // BGM再開
        bgmManager.stop();
        bgmManager.play();
        
        this.init();
        this.updateDisplay();
        this.updateModeInfo();
        this.drawHold();  // ホールドキャンバスをクリア
    }

    cleanup() {
        this.stopTimer();
        
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.logFlushTimer !== null) {
            clearInterval(this.logFlushTimer);
            this.logFlushTimer = null;
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
        //this.weights = {
        //    height: -0.5,        // 高さペナルティ
        //    holes: -3.5,         // 穴ペナルティ（強め）
        //    bumpiness: -0.2,     // 凹凸ペナルティ
        //    linesCleared: 3.0,   // ライン消去ボーナス
        //    wellDepth: 0.1,      // 井戸（テトリス用の溝）ボーナス
        //    multipleWells: -10.0 // 複数井戸ペナルティ（強め）
        //};
        
        // 学習で発見した最適な重み (世代404, Fitness: 199447.6599999905)
        this.weights = {
            height: -0.032357,
            holes: -16.102201,
            bumpiness: -2.000000,
            linesCleared: 0.000000,
            wellDepth: -1.000000,
            multipleWells: -4.997465
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
                case 'c': case 'C': e.preventDefault(); pg.hold(); break;
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
            case 'c':
            case 'C':
                e.preventDefault();
                game.hold();
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
        { id: 'downBtn2', action: () => { const g = getTargetGame(); if (g && !g.isPaused && !g.isGameOver) g.hardDrop(); } },
        { id: 'holdBtn', action: () => { const g = getTargetGame(); if (g && !g.isPaused && !g.isGameOver) g.hold(); } }
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
    
    // 効果音・BGM初期化
    soundManager.init();
    bgmManager.init();
    bgmManager.stop();
    bgmManager.play();
    
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
// ランキング状態
let currentRankingMode = 'normal';
let currentRankingScope = 'mine';   // 'mine' | 'world'
let currentRankingPeriod = '30d';   // '30d' | 'all'
let worldRankingCache = {};         // { key: { data, fetchedAt } }

function showRanking(mode, event) {
    currentRankingMode = mode;
    if (event && event.target) {
        document.querySelectorAll('.ranking-tab').forEach(t => t.classList.remove('active'));
        event.target.classList.add('active');
    }
    updateRankingList();
}

function switchRankingScope(scope, event) {
    currentRankingScope = scope;
    if (event && event.target) {
        document.querySelectorAll('.ranking-scope-tab').forEach(t => t.classList.remove('active'));
        event.target.classList.add('active');
    }
    // 世界タブのサブフィルターを表示/非表示
    const worldFilters = document.getElementById('worldRankingFilters');
    if (worldFilters) {
        worldFilters.style.display = scope === 'world' ? 'flex' : 'none';
    }
    updateRankingList();
}

function switchRankingPeriod(period, event) {
    currentRankingPeriod = period;
    if (event && event.target) {
        document.querySelectorAll('.ranking-period-tab').forEach(t => t.classList.remove('active'));
        event.target.classList.add('active');
    }
    updateRankingList();
}


// 旧API互換（toggleRankingTypeはAIタブ削除で不要になるが念のため残す）
function toggleRankingType(type, event) {}

function formatRankingValue(record, mode) {
    if (mode === 'normal') return `${record.score.toLocaleString()} 点`;
    if (mode === 'sprint1m') return `${record.lines} ライン`;
    const t = record.time / 1000;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

function updateRankingList() {
    if (currentRankingScope === 'mine') {
        _renderMineRanking();
    } else {
        _renderWorldRanking();
    }
}

function _renderMineRanking() {
    const records = JSON.parse(localStorage.getItem('tetrisRecords') || '{}');
    const rankingList = document.getElementById('rankingList');
    const data = records[currentRankingMode];

    if (!data || data.length === 0) {
        rankingList.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">記録はまだありません</div>';
        return;
    }

    rankingList.innerHTML = data.map((record, i) => {
        const date = new Date(record.date);
        const dateStr = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}`;
        return `
            <div class="ranking-item">
                <span class="rank">#${i + 1}</span>
                <span class="time">${formatRankingValue(record, currentRankingMode)}</span>
                <span class="date">${dateStr}</span>
            </div>`;
    }).join('');
}

async function _renderWorldRanking() {
    const rankingList = document.getElementById('rankingList');
    const cacheKey = `${currentRankingMode}_${currentRankingPeriod}`;
    const cached = worldRankingCache[cacheKey];
    // 30秒キャッシュ
    if (cached && Date.now() - cached.fetchedAt < 30000) {
        _renderWorldRows(cached.data);
        return;
    }
    rankingList.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">読み込み中...</div>';
    try {
        const params = new URLSearchParams({
            mode: currentRankingMode,
            period: currentRankingPeriod,
            limit: 100
        });
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-ranking?${params}`, {
            headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const data = await res.json();
        worldRankingCache[cacheKey] = { data, fetchedAt: Date.now() };
        _renderWorldRows(data);
    } catch (e) {
        rankingList.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">取得に失敗しました</div>';
    }
}

function _renderWorldRows(rows) {
    const rankingList = document.getElementById('rankingList');
    rankingList.innerHTML = '';

    if (!rows || rows.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center;color:#888;padding:20px;';
        empty.textContent = 'まだ記録がありません';
        rankingList.appendChild(empty);
        return;
    }

    rows.forEach((r, i) => {
        let val = '';
        if (currentRankingMode === 'normal') val = `${Number(r.score).toLocaleString()} 点`;
        else if (currentRankingMode === 'sprint1m') val = `${r.lines} ライン`;
        else {
            const t = r.time_ms / 1000;
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            const ms = Math.floor((t % 1) * 1000);
            val = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
        }

        const item = document.createElement('div');
        item.className = 'ranking-item';

        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = `#${i + 1}`;

        const name = document.createElement('span');
        name.className = 'player-name';
        // textContentを使うことでHTMLタグが文字として表示される（XSS対策）
        name.textContent = (r.region === 'JP' ? '🇯🇵 ' : '🌍 ') + (r.player_name || '???');

        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = val;

        item.appendChild(rank);
        item.appendChild(name);
        item.appendChild(time);
        rankingList.appendChild(item);
    });
}

// ゲームクリア後の世界ランキング登録
async function submitWorldRanking() {
    if (!game || !game.sessionToken) return;
    const nameInput = document.getElementById('worldRankingName');
    const btn = document.getElementById('worldRankingRegisterBtn');
    const name = (nameInput?.value || '').trim();
    if (!name) {
        nameInput?.focus();
        return;
    }
    btn.disabled = true;
    btn.textContent = '送信中...';
    localStorage.setItem('lastPlayerName', name);

    const result = await game._verifyAndSave(name);
    if (result.ok) {
        btn.textContent = '✅ 登録完了！';
        worldRankingCache = {}; // キャッシュクリア
        // 世界タブに切り替えて結果を表示
        const worldTabBtn = document.querySelector('.ranking-scope-tab[data-scope="world"]');
        if (worldTabBtn) worldTabBtn.click();
    } else {
        btn.disabled = false;
        if (result.error === 'verify_failed') {
            btn.textContent = '❌ 検証失敗（不正なスコア）';
        } else if (result.error === 'flush_failed') {
            btn.textContent = '❌ 通信エラー - もう一度お試しください';
        } else {
            btn.textContent = '❌ 登録失敗 - もう一度';
        }
    }
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
window.switchRankingScope = switchRankingScope;
window.switchRankingPeriod = switchRankingPeriod;
window.submitWorldRanking = submitWorldRanking;
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
        const aiSpeeds = { easy: 1000, normal: 500, hard: 200, expert: 100, master: 50, inferno: 10 };
        
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
        
        bgmManager.stop();  // BGM停止
        
        let title, color;
        if (this.playerGame.isGameOver && this.aiGame.isGameOver) {
            title = 'DRAW'; 
            color = '#ffff00';
            soundManager.playLineClear(2);
        } else if (this.playerGame.isGameOver) {
            // AI観戦モードの場合は「AI2 WIN!」
            title = this.aiVsAi ? '🤖 AI2 WIN!' : 'AI WIN!'; 
            color = '#ff0000';
            if (!this.aiVsAi) soundManager.playGameOver();
        } else {
            // AI観戦モードの場合は「AI1 WIN!」
            title = this.aiVsAi ? '🤖 AI1 WIN!' : 'YOU WIN!'; 
            color = '#00ff00';
            if (!this.aiVsAi) soundManager.playWin();
        }
        
        document.getElementById('battleResultTitle').textContent = title;
        document.getElementById('battleResultTitle').style.color = color;
        document.getElementById('battleResultOverlay').classList.remove('hidden');
    }
    
    togglePause() {
        this.isPaused = !this.isPaused;
        document.getElementById('battlePauseOverlay').classList.toggle('hidden', !this.isPaused);
        
        // BGM一時停止/再開
        if (this.isPaused) {
            bgmManager.pause();
        } else {
            bgmManager.resume();
        }
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
    
    // 効果音・BGM初期化
    soundManager.init();
    bgmManager.init();
    bgmManager.stop();
    bgmManager.play();
    
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
    const diffNames = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert', master: 'Master', inferno: 'Inferno' };
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
    
    // BGM再開
    bgmManager.stop();
    bgmManager.play();
    
    battleManager = new BattleManager(diff, aiVsAi);
    battleManager.start();
}

function goHomeFromBattle() {
    if (battleManager) {
        battleManager.cleanup();
        battleManager = null;
    }
    
    bgmManager.stop();  // BGM停止
    
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
