// ===========================================
// TetrisAI - 観戦・対戦用の自動プレイAI
// ===========================================
import { BOARD_WIDTH, BUFFER_HEIGHT, TOTAL_HEIGHT } from './config.js';

export class TetrisAI {
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
        let rotated = piece.clone();
        for (let i = 0; i < rotations; i++) rotated = rotated.rotated(1);
        return rotated;
    }

    clonePiece(piece) {
        return piece.clone();
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

    // 最善手へのムーブキュー（回転 → 目標xまで横移動 → ハードドロップ）
    // 横移動は実行時に1マスずつ判定するので、壁キックでずれても目標に着く
    generateMoveQueue(targetMove) {
        if (!targetMove || !this.game.currentPiece) return [];
        const moves = [];
        for (let i = 0; i < targetMove.rotation; i++) moves.push('rotate');
        moves.push({ alignTo: targetMove.x });
        moves.push('drop');
        return moves;
    }
}
