# TETRIS-LIKE リニューアル版

## ファイル構成
- index.html / style.css / manifest.json / sw.js … サイト本体（Cloudflare Pagesにそのまま置く）
- js/
  - main.js … 入口
  - ui.js … ホーム・ゲーム画面・結果・設定
  - game.js … ゲーム本体（ロックディレイ、ホールド、ライン消去、スコア）
  - pieces.js … ミノの形とSRS（回転・壁キック）
  - effects.js … 演出（揺れ・パーティクル・残像・ポップアップ）
  - input.js … キーボード／ボタン／スワイプ（押しっぱなしの連続移動）
  - audio.js … 効果音・BGM
  - ai.js / battle.js … AI観戦・AI対戦
  - ranking.js … 世界ランキング（Supabase）
  - records.js … 自分の記録（localStorage）
  - config.js … 定数（サイト名・ロックディレイ・DASなど）
  - settings.js … ユーザー設定
- supabase/functions/log-ops, verify-and-save … 操作の種類 UL（左回転）と K（自然固定）に対応させたもの

## デプロイ順（重要）
1. 先に Supabase の `log-ops` と `verify-and-save` をデプロイ
   （新しいクライアントが送る UL / K をはじかないように）
2. そのあとサイト本体をデプロイ
旧 script.js は不要になります（index.html からは読み込んでいません）。

## ローカルで動かす
ES Modules を使っているので、ファイルを直接開くのではなくサーバー経由で。
  python3 -m http.server 8000  → http://localhost:8000/
