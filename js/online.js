// ===========================================
// オンライン対戦（Supabase Realtime: Broadcast + Presence）
// テーブルは使わない。同じ部屋番号のチャンネルに入った2人でメッセージを送り合う
//
// メッセージ（payload.type）
//   hello   … 相手を見つけた（ゲスト→ホスト。開始の合図をもらうまで1秒ごと）
//   start   … 試合開始（ホスト→ゲスト）
//   state   … 自分の盤面と操作中のミノ（150msに1回まで）
//   garbage … おじゃまライン n 本
//   dead    … 自分が負けた
//   rematch … もう一度やりたい
// ===========================================
import {
    SUPABASE_URL, SUPABASE_ANON_KEY, BOARD_WIDTH, BOARD_HEIGHT, BUFFER_HEIGHT, TOTAL_HEIGHT,
    PIECE_COLORS, GARBAGE_COLOR
} from './config.js';
import { TetrisGame, drawBlock } from './game.js';
import { soundManager, bgmManager } from './audio.js';

const STATE_INTERVAL_MS = 150;

// ---------- 盤面を文字列にして送る（1マス1文字） ----------
const COLOR_TO_CHAR = {};
const CHAR_TO_COLOR = { G: GARBAGE_COLOR };
for (const [t, c] of Object.entries(PIECE_COLORS)) { COLOR_TO_CHAR[c] = t; CHAR_TO_COLOR[t] = c; }

function encodeBoard(board) {
    let s = '';
    for (let by = BUFFER_HEIGHT; by < TOTAL_HEIGHT; by++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
            const c = board[by][x];
            s += c === null ? '.' : (COLOR_TO_CHAR[c] || 'G');
        }
    }
    return s;
}

function decodeBoard(s) {
    const rows = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < BOARD_WIDTH; x++) {
            const ch = s[y * BOARD_WIDTH + x];
            row.push(!ch || ch === '.' ? null : (CHAR_TO_COLOR[ch] || GARBAGE_COLOR));
        }
        rows.push(row);
    }
    return rows;
}

function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------- Supabase のチャンネルを作る ----------
let supabaseClient = null;
async function createChannel(name, myId) {
    // テスト用の差し替え口（ローカルで2画面テストするとき）
    if (window.__tlRealtimeFactory) return window.__tlRealtimeFactory(name, myId);
    if (!supabaseClient) {
        // オンライン対戦を選んだときだけ読み込む（普段のプレイとオフラインには影響しない）
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            realtime: { params: { eventsPerSecond: 20 } }
        });
    }
    return supabaseClient.channel(name, {
        config: { broadcast: { self: false }, presence: { key: myId } }
    });
}

// ===========================================
// 部屋（接続・相手探し・開始の合図・再戦）
// ===========================================
export class OnlineRoom {
    /**
     * handlers: onStatus(status)  'connecting' | 'waiting' | 'full' | 'error'
     *           onStart()         試合開始
     *           onMessage(msg)    試合中のメッセージ
     *           onOpponentLeft()
     */
    constructor(code, handlers) {
        this.code = code;
        this.h = handlers;
        this.myId = randomId();
        this.joinedAt = Date.now();
        this.channel = null;
        this.opponentId = null;
        this.isHost = false;
        this.phase = 'idle';      // idle → waiting → playing → ended
        this.myRematch = false;
        this.oppRematch = false;
        this.helloTimer = null;
        this.closed = false;
    }

    async join() {
        this.h.onStatus('connecting');
        try {
            this.channel = await createChannel(`tetris-like-room-${this.code}`, this.myId);
        } catch (e) {
            console.warn('realtime load failed', e);
            this.h.onStatus('error');
            return;
        }
        if (this.closed) return;
        const ch = this.channel;
        ch.on('presence', { event: 'sync' }, () => this._onPresence());
        ch.on('broadcast', { event: 'msg' }, ({ payload }) => this._onBroadcast(payload));
        ch.subscribe(async (status) => {
            if (this.closed) return;
            if (status === 'SUBSCRIBED') {
                await ch.track({ joinedAt: this.joinedAt });
                if (this.phase === 'idle') { this.phase = 'waiting'; this.h.onStatus('waiting'); }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                this.h.onStatus('error');
            }
        });
    }

    _players() {
        const state = this.channel.presenceState();
        const list = [];
        for (const [key, metas] of Object.entries(state)) {
            const joinedAt = Math.min(...metas.map(m => m.joinedAt || Infinity));
            list.push({ id: key, joinedAt });
        }
        list.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
        return list;
    }

    _onPresence() {
        if (this.closed) return;
        const players = this._players();
        const idx = players.findIndex(p => p.id === this.myId);
        if (idx < 0) return;                         // 自分の登録がまだ反映されていない
        if (idx >= 2) {                              // 3人目以降は入れない
            this.h.onStatus('full');
            this.leave();
            return;
        }
        const opp = players.slice(0, 2).find(p => p.id !== this.myId);
        if (!opp) {
            if (this.opponentId) {
                // 相手がいなくなった
                const was = this.phase;
                this.opponentId = null;
                this.myRematch = this.oppRematch = false;
                this.phase = 'waiting';
                this.h.onOpponentLeft(was);
                this.h.onStatus('waiting');
            }
            return;
        }
        if (this.opponentId === opp.id) return;
        this.opponentId = opp.id;
        this.isHost = players[0].id === this.myId;
        if (!this.isHost) this._startHello();
    }

    // ゲストは開始の合図が来るまで「来たよ」を送り続ける
    _startHello() {
        clearInterval(this.helloTimer);
        const send = () => {
            if (this.phase !== 'waiting' || !this.opponentId) { clearInterval(this.helloTimer); return; }
            this.send('hello');
        };
        send();
        this.helloTimer = setInterval(send, 1000);
    }

    _onBroadcast(msg) {
        if (this.closed || !msg || msg.from === this.myId) return;
        if (this.opponentId && msg.from !== this.opponentId) return;   // 部屋の3人目からのメッセージは無視
        switch (msg.type) {
            case 'hello':
                if (this.isHost && this.phase === 'waiting') this._hostStart();
                break;
            case 'start':
                if (!this.isHost && (this.phase === 'waiting' || this.phase === 'ended')) this._begin();
                break;
            case 'rematch':
                this.oppRematch = true;
                this._maybeRematch();
                break;
            default:
                if (this.phase === 'playing') this.h.onMessage(msg);
        }
    }

    _hostStart() {
        this.send('start');
        this._begin();
    }

    _begin() {
        clearInterval(this.helloTimer);
        this.phase = 'playing';
        this.myRematch = this.oppRematch = false;
        this.h.onStart();
    }

    // 試合が終わったら呼ぶ
    markEnded() {
        if (this.phase === 'playing') this.phase = 'ended';
    }

    requestRematch() {
        this.myRematch = true;
        this.send('rematch');
        this._maybeRematch();
    }

    _maybeRematch() {
        if (this.phase !== 'ended' || !this.myRematch || !this.oppRematch) return;
        if (this.isHost) this._hostStart();
        // ゲストはホストの start を待つ
    }

    send(type, data = {}) {
        if (!this.channel || this.closed) return;
        this.channel.send({ type: 'broadcast', event: 'msg', payload: { type, from: this.myId, ...data } });
    }

    leave() {
        this.closed = true;
        clearInterval(this.helloTimer);
        try {
            this.channel?.untrack?.();
            this.channel?.unsubscribe();
            if (supabaseClient && this.channel) supabaseClient.removeChannel(this.channel);
        } catch { /* ignore */ }
    }
}

// ===========================================
// 相手の盤面（受け取った state を描くだけ）
// ===========================================
class RemoteView {
    constructor(canvasId, blockSize) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.board = Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null));
        this.piece = null;     // { color, cells: [[x, y], ...] }
        this.lines = 0;
        this.score = 0;
        this.setSize(blockSize);
    }

    setSize(bs) {
        this.bs = bs;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = BOARD_WIDTH * bs, h = BOARD_HEIGHT * bs;
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    apply(msg) {
        if (typeof msg.b === 'string') this.board = decodeBoard(msg.b);
        this.piece = msg.p ? { color: PIECE_COLORS[msg.p.t] || GARBAGE_COLOR, cells: msg.p.c } : null;
        this.lines = msg.l | 0;
        this.score = msg.s | 0;
    }

    stackHeight() {
        for (let y = 0; y < BOARD_HEIGHT; y++) if (this.board[y].some(c => c !== null)) return BOARD_HEIGHT - y;
        return 0;
    }

    draw() {
        const { ctx, bs } = this;
        const W = BOARD_WIDTH * bs, H = BOARD_HEIGHT * bs;
        ctx.fillStyle = '#121729';
        ctx.fillRect(0, 0, W, H);
        for (let y = 0; y < BOARD_HEIGHT; y++) {
            for (let x = 0; x < BOARD_WIDTH; x++) {
                const c = this.board[y][x];
                if (c) drawBlock(ctx, x * bs, y * bs, bs, c);
            }
        }
        if (this.piece) {
            for (const [x, y] of this.piece.cells) if (y >= 0) drawBlock(ctx, x * bs, y * bs, bs, this.piece.color);
        }
    }
}

// ===========================================
// 試合（自分の TetrisGame + 相手の RemoteView）
// ===========================================
export class OnlineBattle {
    /**
     * ui: { blockSizeFn, popupEl, onStats(myGame, remote), onEnd(title, kind, reason), onCountdown(n) }
     */
    constructor(room, ui) {
        this.room = room;
        this.ui = ui;
        this.isMobile = ui.compact ?? (window.innerWidth <= 768);
        this.isRunning = false;
        this.isLive = false;          // カウントダウンが終わって操作できる状態
        this.isPaused = false;        // オンラインは一時停止しない（互換用）
        this.animationFrameId = null;
        this.lastState = '';
        this.lastSentAt = 0;
        this.countdownTimers = [];
    }

    start(countdownSec = 3) {
        this.playerGame = new TetrisGame('battle', false, {
            isBattle: true,
            canvasId: 'gameCanvas',
            nextCanvasId: 'nextCanvas',
            holdCanvasId: 'holdCanvas',
            blockSizeFn: this.ui.blockSizeFn,
            popupEl: this.ui.popupEl,
            onGameOver: () => this.handleLocalDeath(),
            onGarbageSend: (n) => this.room.send('garbage', { n })
        });
        this.remote = new RemoteView('aiCanvas', this.isMobile ? 10 : 16);

        // スマホ: 相手の盤面を自分の盤面に影で重ねる（AI対戦と同じ）
        if (this.isMobile) {
            this.playerGame.onAfterBackgroundDraw = (ctx, bs) => {
                ctx.fillStyle = 'rgba(255, 110, 110, 0.13)';
                const b = this.remote.board;
                for (let y = 0; y < BOARD_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) {
                    if (b[y][x]) ctx.fillRect(x * bs, y * bs, bs, bs);
                }
            };
        }

        this.isRunning = true;
        this.lastUpdateTime = performance.now();
        this.loop();

        // カウントダウン
        for (let i = countdownSec; i >= 1; i--) {
            this.countdownTimers.push(setTimeout(() => {
                this.ui.onCountdown?.(i);
                soundManager.playMove();
            }, (countdownSec - i) * 1000));
        }
        this.countdownTimers.push(setTimeout(() => {
            this.ui.onCountdown?.(0);
            soundManager.playRotate();
            this.isLive = true;
            this.lastUpdateTime = performance.now();
        }, countdownSec * 1000));
    }

    loop() {
        if (!this.isRunning) return;
        const now = performance.now();
        const dt = Math.min(100, now - this.lastUpdateTime);
        this.lastUpdateTime = now;
        if (this.isLive) this.playerGame.update(dt);
        this.playerGame.draw();
        this.remote.draw();
        this.ui.onStats?.(this.playerGame, this.remote);
        if (this.isLive) this.maybeSendState(now);
        this.animationFrameId = requestAnimationFrame(() => this.loop());
    }

    // 盤面か操作中のミノが変わったときだけ送る（最短150ms間隔）
    maybeSendState(now) {
        if (now - this.lastSentAt < STATE_INTERVAL_MS) return;
        const g = this.playerGame;
        const b = encodeBoard(g.board);
        const p = g.currentPiece ? { t: g.currentPiece.type, c: g.currentPiece.cells().map(c => [c.x, c.y]) } : null;
        const sig = b + JSON.stringify(p) + g.linesCleared;
        if (sig === this.lastState) return;
        this.lastState = sig;
        this.lastSentAt = now;
        this.room.send('state', { b, p, l: g.linesCleared, s: g.score });
    }

    onMessage(msg) {
        if (!this.isRunning) return;
        switch (msg.type) {
            case 'state':
                this.remote.apply(msg);
                break;
            case 'garbage':
                if (this.isLive) this.playerGame.receiveGarbage(Math.max(0, Math.min(20, msg.n | 0)));
                break;
            case 'dead':
                this.finish('win', 'dead');
                break;
        }
    }

    handleLocalDeath() {
        if (!this.isRunning) return;
        this.room.send('dead');
        this.finish('lose');
    }

    opponentLeft() {
        if (this.isRunning) this.finish('win', 'left');
    }

    finish(kind, reason) {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.isLive = false;
        cancelAnimationFrame(this.animationFrameId);
        this.countdownTimers.forEach(clearTimeout);
        this.playerGame.draw();
        this.remote.draw();
        this.room.markEnded();
        bgmManager.stop();
        if (kind === 'win') soundManager.playWin(); else soundManager.playGameOver();
        this.ui.onEnd?.(kind === 'win' ? 'YOU WIN!' : 'YOU LOSE', kind, reason);
    }

    togglePause() { /* オンラインでは止めない */ }

    cleanup() {
        this.isRunning = false;
        this.isLive = false;
        cancelAnimationFrame(this.animationFrameId);
        this.countdownTimers.forEach(clearTimeout);
        this.playerGame?.cleanup();
        this.playerGame = null;
    }
}
