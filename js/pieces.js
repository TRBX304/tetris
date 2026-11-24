// ===========================================
// ミノの形と SRS（スーパーローテーションシステム）
// ===========================================
import { PIECE_COLORS } from './config.js';

// 向き0（出現時）の形。JLSTZ は 3x3、I は 4x4、O は 2x2 の枠
const BASE_SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
};

function rotateMatrixCW(m) {
    const n = m.length;
    return m.map((row, r) => row.map((_, c) => m[n - 1 - c][r]));
}

// SHAPES[type][rot]  rot: 0=出現, 1=右(R), 2=逆(2), 3=左(L)
// 枠ごと回転するので SRS の形と一致する
export const SHAPES = {};
for (const [type, base] of Object.entries(BASE_SHAPES)) {
    const states = [base];
    for (let i = 1; i < 4; i++) states.push(rotateMatrixCW(states[i - 1]));
    SHAPES[type] = states;
}

// SRS 壁キック表（公式の表記：y は上がプラス）
const KICKS_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
};
const KICKS_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
};

// 画面座標（y は下がプラス）に変換して返す
export function getKicks(type, from, to) {
    if (type === 'O') return [[0, 0]];
    const table = type === 'I' ? KICKS_I : KICKS_JLSTZ;
    return (table[`${from}${to}`] || [[0, 0]]).map(([x, y]) => [x, -y]);
}

// 出現位置（下の段が画面の一番上 y=0 に来る）
const SPAWN = {
    I: { x: 3, y: -1 },
    O: { x: 4, y: -1 },
    T: { x: 3, y: -1 }, S: { x: 3, y: -1 }, Z: { x: 3, y: -1 },
    J: { x: 3, y: -1 }, L: { x: 3, y: -1 }
};

export class Tetromino {
    constructor(type) {
        this.type = type;
        this.rot = 0;
        this.shape = SHAPES[type][0];
        this.color = PIECE_COLORS[type];
        this.position = { ...SPAWN[type] };
    }

    clone() {
        const p = new Tetromino(this.type);
        p.rot = this.rot;
        p.shape = this.shape;
        p.position = { ...this.position };
        return p;
    }

    // 壁キックなしで回転させたコピー（dir: 1=右回転, -1=左回転）
    rotated(dir) {
        const p = this.clone();
        p.rot = (this.rot + dir + 4) % 4;
        p.shape = SHAPES[this.type][p.rot];
        return p;
    }

    // 埋まっているマスの一覧（ピース座標）
    cells() {
        const out = [];
        for (let i = 0; i < this.shape.length; i++) {
            for (let j = 0; j < this.shape[i].length; j++) {
                if (this.shape[i][j]) out.push({ x: this.position.x + j, y: this.position.y + i });
            }
        }
        return out;
    }
}

// NEXT/HOLD 表示用：空の行・列を除いた形
export function trimmedShape(type) {
    const s = SHAPES[type][0];
    const rows = s.filter(r => r.some(Boolean));
    const cols = rows[0].map((_, c) => rows.some(r => r[c]));
    return rows.map(r => r.filter((_, c) => cols[c]));
}
