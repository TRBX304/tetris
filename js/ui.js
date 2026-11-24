// ===========================================
// 画面まわり（ホーム・ゲーム画面・オーバーレイ・設定）
// ===========================================
import { APP_NAME, BOARD_WIDTH, BOARD_HEIGHT, MODE_LABELS, SPRINT_DURATION_MS } from './config.js';
import { TetrisGame } from './game.js';
import { BattleManager, DIFFICULTY_LABELS } from './battle.js';
import { soundManager, bgmManager } from './audio.js';
import { settings, setSetting, isTouchDevice } from './settings.js';
import { getRecords, formatTime, formatValue, bestValue } from './records.js';
import { fetchWorldRanking, clearRankingCache } from './ranking.js';
import { setupInput } from './input.js';

const $ = (id) => document.getElementById(id);

let game = null;            // ソロプレイ中の TetrisGame
let battle = null;          // AI対戦中の BattleManager
let aiMode = false;         // AI観戦モード
let currentMode = 'normal';

const rankState = { scope: 'mine', mode: 'normal', period: '30d' };

// 操作対象のゲーム（入力用）
function activeGame() {
    if (battle && battle.isRunning) return battle.isPaused ? null : battle.playerGame;
    return game && !game.isGameOver ? game : null;
}

// ===========================================
// 盤面サイズ（画面に収まる一番大きいサイズ）
// ===========================================
function blockSizeFn() {
    const area = document.querySelector('.game-area');
    const mobile = window.innerWidth <= 768;
    const sideW = document.querySelector('.side-left').offsetWidth + document.querySelector('.side-right').offsetWidth;
    const aiPanelW = battle && !mobile ? 200 : 0;
    const gaps = mobile ? 12 + 24 + 8 : 24 + 24 + 10;
    const availW = window.innerWidth - sideW - aiPanelW - gaps;
    const availH = area.clientHeight - 10;
    const bs = Math.floor(Math.min(availW / BOARD_WIDTH, availH / BOARD_HEIGHT));
    return Math.max(12, Math.min(mobile ? 36 : 32, bs));
}

// ===========================================
// ゲーム → UI の通知
// ===========================================
const hooks = {
    onStats(g) {
        $('scoreDisplay').textContent = g.score.toLocaleString();
        $('levelDisplay').textContent = g.level;
        $('linesDisplay').textContent = g.linesCleared;
        if (g.targetLines && g.targetLines !== Infinity) {
            const left = Math.max(0, g.targetLines - g.linesCleared);
            $('remainDisplay').textContent = left;
            $('remainStat').classList.toggle('hot', left <= 3 && left > 0);
        }
    },
    onTime(g) {
        const el = $('timeDisplay');
        if (g.mode === 'normal') {
            el.textContent = formatTime(g.elapsedTime, false);
        } else if (g.mode === 'sprint1m') {
            // 1分間は残り時間を表示
            const left = Math.max(0, SPRINT_DURATION_MS - g.elapsedTime);
            el.textContent = formatTime(left);
            el.classList.toggle('hot', left <= 10000);
        } else {
            el.textContent = formatTime(g.elapsedTime);
        }
    },
    onFinish(kind, g) {
        setTimeout(() => showResult(kind, g), kind === 'gameover' ? 500 : 350);
    },
    onPause(paused) {
        $('pauseOverlay').classList.toggle('hidden', !paused);
    }
};

// ===========================================
// 画面切り替え
// ===========================================
function showGameScreen() {
    $('homeScreen').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');
    closeAllOverlays();
}

function goHome() {
    teardown();
    bgmManager.stop();
    $('gameScreen').classList.add('hidden');
    $('homeScreen').classList.remove('hidden');
    closeAllOverlays();
    refreshHome();
    window.scrollTo(0, 0);
}

function teardown() {
    if (game) { game.cleanup(); game = null; }
    if (battle) { battle.cleanup(); battle = null; }
    inputCtl && inputCtl.releaseAll();
}

function closeAllOverlays() {
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
}

// 操作パッドの表示（タッチ端末だけ。AIが操作するときは出さない）
function updateControlsVisibility(aiPlaying) {
    const touch = isTouchDevice();
    const showPad = touch && !aiPlaying && settings.control === 'button';
    const showSwipe = touch && !aiPlaying && settings.control === 'swipe';
    $('buttonControls').classList.toggle('hidden', !showPad);
    $('swipeBar').classList.toggle('hidden', !showSwipe);
}

function prepareAudio() {
    soundManager.init();
    soundManager.enabled = settings.sfx;
    bgmManager.init();
    bgmManager.stop();
    if (settings.bgm) bgmManager.play();
}

// ===========================================
// ソロプレイ開始
// ===========================================
function startGame(mode) {
    teardown();
    currentMode = mode;
    if (mode !== 'practice') localStorage.setItem('lastMode', mode);
    prepareAudio();
    showGameScreen();

    $('aiGamePanel').classList.add('hidden');
    $('aiGaugePanel').classList.add('hidden');
    $('undoButton').classList.toggle('hidden', mode !== 'practice');
    $('scoreStat').classList.toggle('hidden', mode !== 'normal' && mode !== 'practice');
    $('levelStat').classList.toggle('hidden', mode !== 'normal' && mode !== 'practice');
    $('remainStat').classList.toggle('hidden', !mode.startsWith('time'));
    $('remainStat').classList.remove('hot');
    const t = $('timeDisplay');
    t.classList.remove('hot');
    t.textContent = mode === 'practice' ? '' : mode === 'sprint1m' ? '01:00.000' : mode === 'normal' ? '00:00' : '00:00.000';
    $('modeInfo').textContent = (aiMode ? 'AI ・ ' : '') + (MODE_LABELS[mode] || '');
    updateControlsVisibility(aiMode);

    game = new TetrisGame(mode, aiMode, {
        blockSizeFn,
        popupEl: $('boardPopup'),
        hooks
    });
}

// ===========================================
// AI対戦開始
// ===========================================
let lastBattle = null;

function startBattle(difficulty) {
    teardown();
    lastBattle = { difficulty, aiVsAi: aiMode };
    prepareAudio();
    showGameScreen();

    $('aiGamePanel').classList.remove('hidden');
    $('aiGaugePanel').classList.remove('hidden');
    $('undoButton').classList.add('hidden');
    $('scoreStat').classList.remove('hidden');
    $('levelStat').classList.add('hidden');
    $('remainStat').classList.add('hidden');
    $('timeDisplay').textContent = '';
    $('modeInfo').textContent = `${aiMode ? 'AI vs AI' : 'AI対戦'} ・ ${DIFFICULTY_LABELS[difficulty]}`;
    updateControlsVisibility(aiMode);

    battle = new BattleManager(difficulty, aiMode, {
        blockSizeFn,
        popupEl: $('boardPopup'),
        onPause: hooks.onPause,
        onStats(pg, ag) {
            $('scoreDisplay').textContent = pg.score.toLocaleString();
            $('linesDisplay').textContent = pg.linesCleared;
            $('aiScoreDisplay').textContent = ag.score.toLocaleString();
            $('aiLinesDisplay').textContent = ag.linesCleared;
        },
        onEnd(title, kind) {
            setTimeout(() => showBattleResult(title, kind), 500);
        }
    });
    battle.start();
}

// ===========================================
// 結果画面
// ===========================================
function showResult(kind, g) {
    if (g !== game) return;
    const titles = { gameover: 'GAME OVER', sprint: 'TIME UP', timeattack: 'COMPLETE!' };
    const title = $('resultTitle');
    title.textContent = titles[kind];
    title.className = 'sheet-title' + (kind === 'gameover' ? ' lose' : ' win');
    $('resultMode').textContent = (g.isAIMode ? 'AI ・ ' : '') + MODE_LABELS[g.mode];

    const value = g.mode === 'normal' ? g.score : g.mode === 'sprint1m' ? g.linesCleared : g.elapsedTime;
    $('resultValue').textContent = formatValue(g.mode, value);

    const best = $('resultBest');
    best.className = 'result-best';
    best.textContent = '';
    if (!g.isAIMode) {
        const b = bestValue(g.mode);
        if (b !== null && b === value) {
            best.textContent = '自己ベスト更新！';
            best.classList.add('new');
        } else if (b !== null) {
            best.textContent = `自己ベスト ${formatValue(g.mode, b)}`;
        }
    }

    // 世界ランキング登録（セッションがあるときだけ）
    const canRegister = g.rs && g.rs.token && (g.mode !== 'normal' || g.score > 0);
    $('registerArea').classList.toggle('hidden', !canRegister);
    const btn = $('registerBtn');
    btn.disabled = false;
    btn.textContent = '世界ランキングに登録';
    $('registerMsg').textContent = '';
    $('registerMsg').className = 'register-msg';
    $('playerName').value = localStorage.getItem('lastPlayerName') || '';

    $('resultOverlay').classList.remove('hidden');
}

function showBattleResult(title, kind) {
    const t = $('resultTitle');
    t.textContent = title;
    t.className = 'sheet-title' + (kind === 'win' ? ' win' : kind === 'lose' ? ' lose' : '');
    $('resultMode').textContent = `AI対戦 ・ ${DIFFICULTY_LABELS[lastBattle.difficulty]}`;
    $('resultValue').textContent = battle ? `${battle.playerGame.linesCleared} ライン` : '';
    $('resultBest').textContent = '';
    $('registerArea').classList.add('hidden');
    $('resultOverlay').classList.remove('hidden');
}

async function submitRanking() {
    if (!game) return;
    const input = $('playerName');
    const btn = $('registerBtn');
    const msg = $('registerMsg');
    const name = input.value.trim();
    if (!name) {
        msg.textContent = '名前を入力してください';
        msg.className = 'register-msg error';
        input.focus();
        return;
    }
    btn.disabled = true;
    btn.textContent = '送信中…';
    msg.textContent = '';
    localStorage.setItem('lastPlayerName', name);

    const r = await game.submitRanking(name);
    if (r.ok) {
        btn.textContent = '登録しました';
        msg.textContent = r.is_flagged ? '確認のため、反映されないことがあります' : 'ホームの「世界」タブで見られます';
        msg.className = 'register-msg';
        clearRankingCache();
        rankState.scope = 'world';
        rankState.mode = game.mode;
    } else {
        btn.disabled = false;
        btn.textContent = 'もう一度送る';
        const errors = {
            verify_failed: '記録を確認できませんでした',
            flush_failed: '通信エラーです。もう一度お試しください',
            already_saved: 'この記録はもう登録されています',
            rate_limited: '登録が多すぎます。少し時間をおいてください'
        };
        msg.textContent = errors[r.error] || '登録できませんでした';
        msg.className = 'register-msg error';
        if (r.error === 'already_saved' || r.error === 'verify_failed') btn.disabled = true;
    }
}

// ===========================================
// ホーム
// ===========================================
function refreshHome() {
    const last = localStorage.getItem('lastMode') || 'normal';
    $('heroMode').textContent = MODE_LABELS[last] || 'ノーマル';
    const b = bestValue(last);
    $('heroBest').textContent = b === null ? 'まだ記録なし' : formatValue(last, b);
    $('heroPlay').onclick = () => startGame(last);

    document.querySelectorAll('[data-best]').forEach(el => {
        const m = el.dataset.best;
        const v = bestValue(m);
        el.textContent = v === null ? '—' : (m === 'normal' || m === 'sprint1m' ? 'ベスト ' : '') + formatValue(m, v);
    });
    syncRankingTabs();
    renderRanking();
}

function syncRankingTabs() {
    document.querySelectorAll('#scopeSeg button').forEach(b => b.classList.toggle('active', b.dataset.scope === rankState.scope));
    document.querySelectorAll('#rankModeChips .chip').forEach(b => b.classList.toggle('active', b.dataset.mode === rankState.mode));
    document.querySelectorAll('#periodSeg button').forEach(b => b.classList.toggle('active', b.dataset.period === rankState.period));
    $('periodSeg').classList.toggle('hidden', rankState.scope !== 'world');
}

function rankRow(no, name, value) {
    const li = document.createElement('li');
    li.className = 'rank-item';
    const n = document.createElement('span'); n.className = 'rank-no'; n.textContent = no;
    const nm = document.createElement('span'); nm.className = 'rank-name'; nm.textContent = name;   // textContent でXSS対策
    const v = document.createElement('span'); v.className = 'rank-value num'; v.textContent = value;
    li.append(n, nm, v);
    return li;
}

function emptyRow(text) {
    const li = document.createElement('li');
    li.className = 'rank-empty';
    li.textContent = text;
    return li;
}

function flag(region) {
    if (!region || region.length !== 2 || region === 'XX') return '';
    return String.fromCodePoint(...[...region.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) + ' ';
}

async function renderRanking() {
    const list = $('rankingList');
    const { scope, mode, period } = rankState;
    list.replaceChildren();

    if (scope === 'mine') {
        const data = getRecords()[mode];
        if (!data || !data.length) { list.append(emptyRow('まだ記録がありません。遊んでみよう')); return; }
        data.forEach((r, i) => {
            const d = new Date(r.date);
            const value = mode === 'normal' ? r.score : mode === 'sprint1m' ? r.lines : r.time;
            list.append(rankRow(i + 1, `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`, formatValue(mode, value)));
        });
        return;
    }

    list.append(emptyRow('読み込み中…'));
    try {
        const rows = await fetchWorldRanking(mode, period);
        if (rankState.scope !== scope || rankState.mode !== mode || rankState.period !== period) return;
        list.replaceChildren();
        if (!rows.length) { list.append(emptyRow('まだ記録がありません')); return; }
        rows.forEach((r, i) => {
            const value = mode === 'normal' ? r.score : mode === 'sprint1m' ? r.lines : r.time_ms;
            list.append(rankRow(i + 1, flag(r.region) + (r.player_name || '???'), formatValue(mode, value)));
        });
    } catch {
        if (rankState.scope !== scope) return;
        list.replaceChildren(emptyRow('取得できませんでした（オフライン？）'));
    }
}

// ===========================================
// 一時停止
// ===========================================
function togglePause(force) {
    if (battle && battle.isRunning) battle.togglePause(force);
    else if (game && !game.isGameOver) game.togglePause(force);
}

function restart() {
    if (battle || lastBattle && !game) {
        if (lastBattle) { aiMode = lastBattle.aiVsAi; startBattle(lastBattle.difficulty); syncAiToggle(); }
    } else {
        startGame(currentMode);
    }
}

function syncAiToggle() {
    $('aiModeToggle').checked = aiMode;
    $('aiModeDesc').textContent = aiMode ? 'ON：AIがプレイします' : 'OFF：自分でプレイ';
}

// ===========================================
// 設定
// ===========================================
function syncSettingsUI() {
    document.querySelectorAll('#controlSeg button').forEach(b => b.classList.toggle('active', b.dataset.control === settings.control));
    $('reducedToggle').checked = settings.reducedMotion;
    $('sfxToggle').checked = settings.sfx;
    $('bgmToggle').checked = settings.bgm;
}

function applyControlChange() {
    if ($('gameScreen').classList.contains('hidden')) return;
    const aiPlaying = battle ? battle.aiVsAi : game ? game.isAIMode : false;
    updateControlsVisibility(aiPlaying);
    requestAnimationFrame(resizeActive);
}

function resizeActive() {
    if (game) game.resize();
    if (battle && battle.playerGame) battle.playerGame.resize();
}

// ===========================================
// 初期化
// ===========================================
let inputCtl = null;

export function initUI() {
    document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = APP_NAME; });

    inputCtl = setupInput(activeGame, { pause: () => togglePause() });

    // モーダルの開閉
    document.querySelectorAll('[data-open]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.open === 'settingsModal') syncSettingsUI();
            $(btn.dataset.open).classList.remove('hidden');
        });
    });
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', (e) => {
            if (e.target === m || e.target.closest('[data-close]')) m.classList.add('hidden');
        });
    });

    // モード選択
    document.querySelectorAll('.mode-card[data-mode]').forEach(card => {
        card.addEventListener('click', () => startGame(card.dataset.mode));
    });
    document.querySelectorAll('[data-difficulty]').forEach(b => {
        b.addEventListener('click', () => startBattle(b.dataset.difficulty));
    });
    $('aiModeToggle').addEventListener('change', (e) => { aiMode = e.target.checked; syncAiToggle(); });

    // ランキング
    $('scopeSeg').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        rankState.scope = b.dataset.scope; syncRankingTabs(); renderRanking();
    });
    $('rankModeChips').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        rankState.mode = b.dataset.mode; syncRankingTabs(); renderRanking();
    });
    $('periodSeg').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        rankState.period = b.dataset.period; syncRankingTabs(); renderRanking();
    });

    // ゲーム画面のボタン
    $('pauseButton').addEventListener('click', () => togglePause(true));
    $('resumeButton').addEventListener('click', () => togglePause(false));
    $('restartButton').addEventListener('click', restart);
    $('pauseHomeButton').addEventListener('click', goHome);
    $('retryButton').addEventListener('click', restart);
    $('homeButton').addEventListener('click', goHome);
    $('registerBtn').addEventListener('click', submitRanking);
    $('playerName').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRanking(); });

    // 設定
    $('controlSeg').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        setSetting('control', b.dataset.control); syncSettingsUI(); applyControlChange();
    });
    $('reducedToggle').addEventListener('change', (e) => setSetting('reducedMotion', e.target.checked));
    $('sfxToggle').addEventListener('change', (e) => { setSetting('sfx', e.target.checked); soundManager.enabled = e.target.checked; });
    $('bgmToggle').addEventListener('change', (e) => {
        setSetting('bgm', e.target.checked);
        if (!e.target.checked) bgmManager.stop();
        else if (!$('gameScreen').classList.contains('hidden')) { bgmManager.init(); bgmManager.play(); if (activeGame() === null) bgmManager.pause(); }
    });

    // 画面サイズが変わったら盤面も合わせる
    let rt = null;
    window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(resizeActive, 120);
    });

    // アプリを離れたら自動で一時停止
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) togglePause(true);
    });

    syncAiToggle();
    refreshHome();

    // ローカルで動かしているときだけ、デバッグ用に触れるようにする
    if (location.hostname === 'localhost') window.__tl = { get game() { return game; }, get battle() { return battle; } };
}
