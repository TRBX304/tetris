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

// 追加の効果音
SoundManager.prototype.playLock = function () {
    this.playTone(140, 0.04, 'triangle', 0.35);
};
SoundManager.prototype.playHold = function () {
    this.playTone(420, 0.06, 'sine', 0.35);
    setTimeout(() => this.playTone(560, 0.05, 'sine', 0.3), 40);
};

export { SoundManager, BGMManager, soundManager, bgmManager };
