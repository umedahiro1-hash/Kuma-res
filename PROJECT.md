# PROJECT.md — kumamoto-tsunagaru

## 案件概要
- **案件名**: kumamoto-tsunagaru
- **仮の案件像**: 熊本の被災者支援アプリ「Tsunagaru Kumamoto（つながるくまもと）」。安否確認・人探し・物資支援・チャット等を含む生活者向けアプリと推測（現時点では Google Stitch のデザイン画面から推測した仮説であり、要件未確定）。サービス名は2026-07-31付でユーザー指示により「Kumamoto Tsunagaru」から改称。
- **ステータス**: 素材取り込み完了 / 要件受領（requirements-intake）未着手 / プロトタイプ用バックエンドを先行実装済み（詳細は下記「確定事項」）

## インプット台帳
- 取り込んだ素材の一覧・出典・sha256 は [`inputs/MANIFEST.md`](inputs/MANIFEST.md) を参照。
- 現在の取り込み素材: Google Stitch 出力（画面デザイン6画面 + デザイントークン DESIGN.md）のみ。要件を裏付けるヒアリング議事録・仕様書・データ構造の入力はまだ無い。

## 確定事項
- 2026-07-31: 開発者の直接指示により、要件ヒアリング（requirements-intake）を経ずに、既存プロトタイプ（`物資の支援`＝ゆずる/もとめる の掲示板、`人探し`＝安否確認掲示板）に対応するバックエンドを先行実装した（スキル／サブエージェント不使用の直接コーディング指示）。
  - 実装場所: [`backend/`](backend/)（Node.js + Express + better-sqlite3, REST API）、[`frontend/`](frontend/)（プロトタイプHTMLをAPI呼び出しに書き換え）。
  - 起動方法: `cd backend && npm install && npm start` → `http://localhost:8787` （フロントエンドも同一オリジンで配信）。
  - ブラウザで両画面（物資の支援／人探し）の主要フロー（投稿→申し出→予約→相互確認→評価、人探し登録→電話番号照合→メッセージ送信）を動作確認済み。
- 2026-07-31: 開発者の直接指示により、Vercel + Supabase へのデプロイ準備とメール実送信機能を実装した。
  - DB: [`backend/db.js`](backend/db.js) を Postgres(Supabase) / SQLite のデュアルモードに書き換え。`DATABASE_URL` 環境変数が設定されていれば Supabase Postgres（`pg`）、未設定ならローカル開発用に従来の SQLite にフォールバックする。
  - 画像アップロード: `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` が設定されていれば Supabase Storage（バケット名は `SUPABASE_STORAGE_BUCKET`、既定 `uploads`）に保存、未設定ならローカル `backend/uploads/` に保存（Vercel等サーバーレス環境ではローカルディスクが永続化されないため本番では必須設定）。
  - メール送信: Resend（`RESEND_API_KEY`+`EMAIL_FROM`）を採用。未設定の場合はコンソールログのみの送信シミュレーションにフォールバックする。人探し・ペットの「情報が届きました」通知（[`backend/server.js`](backend/server.js) の `/api/persons/:id/message`・`/api/pets/:id/message`）に接続済み。
  - [`backend/server.js`](backend/server.js) 全体を async/await 化（新しい非同期 db.js インターフェースに対応）。画像サイズ上限は Vercel のリクエスト本文上限（既定4.5MB）を考慮し 5MB→3MB に変更（フロント側の事前チェックも合わせて変更）。
  - [`vercel.json`](vercel.json)（Express アプリを単一のサーバーレス関数として配信）、[`backend/.env.example`](backend/.env.example)（必要な環境変数の一覧と取得元の説明）を追加。
  - 【仮置き】Postgres/Supabase 経路はこの開発環境に docker/psql が無く実データベースに対して動作確認できていない（構文チェックとローカル SQLite フォールバック経路のみ動作確認済み）。実データベースでの動作確認は本番/ステージング接続後に必須。
- 2026-07-31: 開発者の直接指示により、サービス名を「Kumamoto Tsunagaru（くまもとつながる）」から「Tsunagaru Kumamoto（つながるくまもと）」に改称し、コード全体（frontend/index.html, backend/server.js）の該当文字列を置換した（案件ディレクトリ名 `kumamoto-tsunagaru` は変更せず）。
- 2026-07-31: 開発者の直接指示により、「さがす」「ペットを探す」画面の絞り込みUIを変更。ステータス系フィルター（さがす：確認中/確認済み、ペット：さがしています/見かけました、探し中/見つかった）を削除し、市区町村（登録データの city 値）によるフィルターに統一。あわせて、さがす画面に既存していた市区町村フィルターの実装バグ（未定義の `personArea` 関数を参照しておりクリックすると例外が発生していた）を修正。
- 2026-07-31: 開発者の指示により GitHub リポジトリを作成・push（[github.com/umedahiro1-hash/Kuma-res](https://github.com/umedahiro1-hash/Kuma-res)）。
- 2026-07-31: 開発者の指示により Supabase（組織 "Kuma-res" ／プロジェクト `kuma-res`、リージョン ap-northeast-1）と Vercel（プロジェクト `umedahiro1/kuma-res`）を実際に構築し、本番デプロイを完了。
  - Supabase Postgres にスキーマ作成・シードデータ投入済み、Storage バケット `uploads`（公開）を作成・アップロード疎通確認済み。
  - Vercel 本番URL: https://kuma-res.vercel.app 。環境変数 `DATABASE_URL`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_STORAGE_BUCKET`/`ADMIN_PASSWORD` を設定済み。`/api/profiles`・`/api/goods`・`/api/pets`・`/api/persons` が実際に Supabase Postgres からデータを返すことを確認済み（【仮置き】#5 は解消）。
  - 【仮置き】GitHub リポジトリと Vercel プロジェクトの自動連携（push時の自動デプロイ）は、Vercel の GitHub App が `umedahiro1-hash/Kuma-res` への書き込みアクセス権を持っていないため失敗しており未設定（現状は `vercel deploy --prod` による手動デプロイのみ）。GitHub 上で該当リポジトリに Vercel App のアクセスを許可すれば有効化できる。
  - 【仮置き】`RESEND_API_KEY`/`EMAIL_FROM` は本番環境にも未設定のため、メール通知は本番でも送信シミュレーション（コンソールログのみ）のまま。実送信には発注者側で Resend アカウント作成・APIキー発行と Vercel への設定が必要。
- 2026-08-01: 開発者の指示により GitHub→Vercel の自動デプロイ連携を設定完了（Vercel の GitHub App を `umedahiro1-hash` アカウントに再インストールし、Vercelアカウントの追加Git連携（Add GitHub Account）を通して解決）。以降 `git push` するだけで自動的に本番デプロイされる。
- 2026-08-01: 開発者の指示により Resend で `kuma-res.jp` ドメインのDNS認証（DKIM/SPF/MX）を完了し、`RESEND_API_KEY`/`EMAIL_FROM=notifications@kuma-res.jp` を本番設定。実際にメール送信・受信を確認済み（仮置き#7は解消）。
- 2026-08-01: 開発者の指示により Vercel にカスタムドメイン `kuma-res.jp` を追加（Aレコード `76.76.21.21`）。本番アクセス可能なことを確認済み。
- 2026-08-01: 開発者の指示による本番検証（画像アップロード・ニュース取得・SMS認証・メール送信）の結果、**ニュースの並び順が日付降順で保証されていないバグ**を発見し修正（Google News RSSの並びをそのまま返していたため、明示的にソートを追加）。画像アップロード・メール送信は問題なし。
- 2026-08-01: 開発者の指示により、SMS認証を「電話番号送信→コードをAPIレスポンスにそのまま返すデモ実装」から実送信へ切り替えを試行。
  - Twilio（有料・$0.084〜0.12/通）を試したが、無料トライアル制限（認証済み番号のみ送信可）、Pro プランへの有料アップグレード後も Trust Hub の Primary Compliance Profile（本人確認）審査が未承認のため送信できず、断念。Twilioアカウントは解約予定。
  - 代わりに Textbelt（https://textbelt.com、KYC不要・クレジット購入制、$5で30通）に切り替え、実際に開発者本人の携帯へのSMS到達を確認済み。
  - 実装は `backend/server.js` の `sendSms()` に Twilio優先／Textbeltフォールバックのロジックとして両方残しており、`TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_FROM_NUMBER` を設定すれば将来的にTwilio審査完了後に切替可能。
  - 【仮置き】Textbelt の有料クレジットは購入した分だけの従量制（$5=30通）。同時に多数のユーザーが登録すると想定より早くクレジットを消費するため、運用開始前に想定登録者数に応じたクレジット残高の運用ルール（監視・補充フロー）を発注者側で検討する必要がある。

## 未確定・顧客確認事項
- このアプリの正式名称・目的（防災アプリ／自治体サービス／NPO 運営サービス等）はデザイン画面からの推測であり未確認。
- 対象ユーザー（被災者本人／支援者／自治体職員）、運営主体、データ連携先（自治体システム・SNS等）は未確認。
- 6画面以外に必要な画面・機能があるかは未確認。

## 仮置き台帳
| # | 仮置き内容 | 確認先 | 確認期限 |
|---|---|---|---|
| 1 | アプリの目的・対象ユーザーはデザイン画面（画面タイトル・DESIGN.md）からの推測 | 発注者 / 要件ヒアリング | requirements-intake 実施時 |
| 2 | バックエンドは「認証なし・ユーザー切替はデモ用ヘッダー（X-User）で本人を自称する」方式で実装（本番の会員認証は未設計）。プロフィール一覧は誰でも取得できる想定 | 発注者 / 要件ヒアリング・設計フェーズ | requirements-intake / 設計フェーズ実施時 |
| 3 | 人探し機能は「電話番号の完全一致」を照合ゲートとして実装（本人確認の強度は未確定。実運用での成りすまし対策の要否は未検討） | 発注者 / 要件ヒアリング | requirements-intake 実施時 |
| 4 | ～2026-07-31: 人探しのメール通知は実送信せずシミュレーション表示のみだったが、2026-07-31 に Resend 実送信を実装済み（`RESEND_API_KEY` 未設定時はシミュレーションにフォールバック） | 発注者 / 要件ヒアリング・設計フェーズ | 設計フェーズ実施時 |
| 5 | ～2026-07-31: Postgres(Supabase) 経路は実データベース未検証だったが、2026-07-31 に実際の Supabase プロジェクトを構築し検証済み（解消） | - | 解消済み |
| 6 | ～2026-08-01: GitHub→Vercel の自動デプロイ連携が未設定だったが、2026-08-01 に設定完了（解消） | - | 解消済み |
| 7 | ～2026-08-01: Resend の実メール送信が本番未設定だったが、2026-08-01 にドメイン認証・APIキー設定・実送信確認まで完了（解消） | - | 解消済み |
| 8 | SMS認証の実送信はTextbelt（有料従量課金・KYC不要）で運用中。本人確認の強度としてはTextbelt側の不正利用対策に依存しており、大量登録が発生した場合のクレジット枯渇・費用増のリスクは未検討 | 発注者 | 本番運用開始前 |

## 次のアクション
- `/requirements-intake` を実行し、この案件の `inputs/` のみを読み込んで要件を構造化する（先行実装したバックエンドの前提・仮置きは、要件確定後に見直しが必要）。
