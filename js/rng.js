// ===========================================
// シード付き乱数 (xorshift32)
// ⚠️ verify-and-save.ts の SeededRandom と完全一致させること
// ===========================================
export class SeededRandom {
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

// 7-bag。ミノの並び順はサーバー側の generatePieceSequence と一致する
export const BAG_ORDER = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export function shuffledBag(rng) {
    const bag = [...BAG_ORDER];
    for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
}
