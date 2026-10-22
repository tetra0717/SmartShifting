# Glint 開発メモ

## 構成

| ファイル | 役割 |
| --- | --- |
| `server.mjs` | HTTP/HTTPS、静的ファイル、起動・終了 |
| `certificate.mjs` | PC用の証明書生成・再利用・更新 |
| `glint-server.mjs` | SSE中継、1つの表示タブ、端末・設定・結果の検証 |
| `logger.mjs` | サーバーログとローテーション |
| `public/glint-display.js` | 描画、表示履歴、Workerへの復号依頼 |
| `public/glint-phone.js` | カメラとRGB統計、判定表示 |
| `public/glint-common.js` | 対象名・配置・光の波形・RGB統計 |
| `public/glint-receiver.js` / `glint-worker.js` | 対象識別と端末ごとの継続確認 |
| `public/glint-input.js` | 判定からゲーム入力への変換と有効期限 |
| `public/game.js` | ゲーム固有の反応を追加する場所 |
| `public/glint-diagnostics.js` | ブラウザのエラー・診断ログ |
| `public/setup.html` / `setup.js` | スマホの初回HTTPS接続ガイド |
| `test/` | 識別、カメラ再取得、HTTP/SSE、入力、ログの回帰テスト |

ビルド工程はありません。初回は `npm ci` で証明書生成用の依存をインストールします。ゲームの処理はまず `game.js` に追加し、必要に応じてモジュールへ分けます。描画を変更する場合も、最終描画を採取する `capture()` は維持します。処理の重いゲーム更新で描画・参照採取の間隔を空けないようにしてください。

## ゲーム入力

`game.js` の `connectGame()` に処理を追加するか、PC画面上で次のイベントを使います。

```js
document.addEventListener('glint:acquired', ({ detail }) => {
  const { deviceId, objectId, name } = detail;
  // この端末が対象を取得したときのゲーム処理
});
document.addEventListener('glint:released', ({ detail }) => {
  const { deviceId, objectId, reason } = detail;
  // 信号の消失、停止、対象の切り替えなどで対象を解除
});
```

`objectId` は0始まり（最大19）。画面の番号は1始まりです。`deviceId` はブラウザ接続のIDで、端末の固有番号ではありません。同じ対象を確認し続けても `acquired` を毎回発火しません。対象が変わった場合は旧対象の `released` →新対象の `acquired` の順です。

`valid: false, held: true` は短い信号低下の保持です。新しい取得イベントを発火しません。確定結果が450ms更新されない場合は解除します。カメラ停止、PC表示の切断、設定変更、タブの非表示時も入力を解除します。この時間は物理的な接触検知の応答時間を保証しません。

## 通信と識別

スマホ → `POST /api/glint/samples` → PCのSSE → Worker → `POST /api/glint/result` →スマホのSSE、という順で処理します。ブラウザの各端末は独立した受信状態を持ち、未処理の入力は最新のものへ置き換えます。

- `revision`：表示の設定世代。異なる世代の入力・結果は使いません。
- `epoch`：端末のカメラ取得世代。再取得前の判定を使いません。
- `seq`：端末ごとの送信順。逆順の入力・判定を使いません。
- `sourceTime`：カメラ側の観測時刻。PCの時計とは直接比較しません。
- `at`：サーバー側の受信時刻。PC画面で結果の期限を確認します。

光の波形・RGB集計・復号閾値は整理前から維持しています。初回は短い観測を試し、後続フレームで確認します。弱い入力は長い観測へ回し、取得後は新しい揺らぎで継続確認します。黒つぶれ・白飛び・一定入力・曖昧な候補は未確定です。適合度は正解率ではありません。

## 環境変数

| 変数 | 既定・用途 |
| --- | --- |
| `PORT` | HTTPポート、8080 |
| `HTTPS_PORT` | HTTPSポート、8443 |
| `TLS_CERT` / `TLS_KEY` | 証明書と鍵のパス。両方指定 |
| `PUBLIC_URL` | PC画面に表示する公開接続先の基底URL |
| `DISABLE_HTTPS=1` | PCのみの開発用。スマホのカメラにはHTTPSが必要 |
| `LOG_DIR` | 自動ログの保存先、既定はプロジェクト内 `logs/` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error`、既定は `info` |

再起動後は両ページを再読み込みします。`.certs/` と `logs/` はGit管理対象外です。開発用サーバーは同じLAN内で使う前提で、公開運用用の認証や端末登録は提供していません。

新しいクローンではPC専用のローカルCAと90日有効のサーバー証明書を生成します。LANアドレス変更・有効期限切れではサーバー証明書を更新し、有効なCAは再利用します。`/setup/ca.crt` で取得できるのはCAの公開証明書だけです。既存の有効な証明書と `TLS_CERT` / `TLS_KEY` の指定は維持し、秘密鍵やOSの信頼設定を配布・自動変更しません。

## 変更後の確認

`npm run check` と `npm test` を実行後、実機で標準設定の取得、別対象への移動、停止、再取得を確認します。2台以上を使うゲームでは同時接続も確認します。自動テストの合成入力は光学系の実測性能を保証しません。
