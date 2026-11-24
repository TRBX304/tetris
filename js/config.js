// ===========================================
// 設定値・定数（ここを変えると全体に反映される）
// ===========================================

// サイト名（名前を変えるときはここと manifest.json だけ書き換える）
export const APP_NAME = 'TETRIS-LIKE';

// Supabase
export const SUPABASE_URL = 'https://tbyixmuibbvhogirfbxa.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRieWl4bXVpYmJ2aG9naXJmYnhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzA5MDgsImV4cCI6MjA5MDM0NjkwOH0.lqgZuq0GcfRewtuXzmZ6ClFIhsFI5ol-WipqRK8fsrU';

// ボード
// ピース座標 y: -2〜19（y<0 はバッファ＝非表示）
// ボード配列 boardY = y + BUFFER_HEIGHT（0〜21）
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const BUFFER_HEIGHT = 2;
export const TOTAL_HEIGHT = BOARD_HEIGHT + BUFFER_HEIGHT;

// ルール
export const SPRINT_DURATION_MS = 60000;
export const LOCK_DELAY_MS = 500;      // 接地してから固定されるまで
export const MAX_LOCK_RESETS = 15;     // 移動・回転でロックディレイをリセットできる回数
export const NEXT_COUNT = 3;           // NEXT表示数

// ライン消去の待ち時間（白く光る + ヒットストップ）
// 旧版は12フレーム（60fpsで約200ms）だったので、ほぼ同じ長さにしている
export const LINE_CLEAR_MS = 100;
export const HITSTOP_MS = 80;

// 入力（押しっぱなし）
export const DAS_MS = 150;             // 連続移動が始まるまで
export const ARR_MS = 40;              // 連続移動の間隔
export const SOFT_DROP_MS = 35;        // ソフトドロップの間隔

export const GAME_STATES = {
    PLAYING: 'PLAYING',
    LINE_CLEARING: 'LINE_CLEARING',
    GAME_OVER: 'GAME_OVER',
    PAUSED: 'PAUSED'
};

// ミノの色（暗い背景でも見えるように明るめ）
export const PIECE_COLORS = {
    I: '#4fd1ff',
    O: '#ffd23f',
    T: '#b46cf0',
    S: '#4ee07a',
    Z: '#ff5a5a',
    J: '#5a7cff',
    L: '#ff9a3c'
};

export const GARBAGE_COLOR = '#5b6278';

export const MODE_LABELS = {
    normal: 'ノーマル',
    sprint1m: '1分間スプリント',
    time10: '10ライン',
    time20: '20ライン',
    time40: '40ライン',
    time100: '100ライン',
    practice: '練習'
};

export const RANKED_MODES = ['normal', 'sprint1m', 'time10', 'time20', 'time40', 'time100'];
