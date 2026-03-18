# Luna & Elma — 天気 & ニュース PWA

シンプルで美しい天気 + ニュース Progressive Web App です。
都市名または現在地から最新の天気情報を取得し、カテゴリ別ニュースと AI アシスタントを提供します。

**公開URL:** https://yuuuki84.github.io/Weather-2-App/

---

## 機能一覧

### 天気

| 機能 | 内容 |
|------|------|
| 都市検索 | 日本語・英語対応、オートコンプリート付き |
| 現在地取得 | GPS ボタンで自動取得 |
| 検索履歴 | 最大 8 件・ローカル保存 |
| お気に入り都市 | 最大 10 件・クラウド同期 |
| URL 共有 | `?city=都市名` パラメータ対応 |
| 大阪エリア対応 | 梅田・なんばなど主要エリアを大阪市として認識 |

**表示データ**

| 項目 | 内容 |
|------|------|
| 気温 | 現在・体感・最低/最高 |
| 天気 | アイコン + 日本語説明 |
| 湿度・気圧・視程・雲量 | 各数値 |
| 風速・風向 | m/s + 16 方位 |
| 雨量・雪量 | mm/h |
| 日の出・日の入 | 現地時刻 |
| 週間予報 | 気象庁（JMA）API 連携 |

**天気アドバイス（ルールベース自動生成）**

| アドバイス | 内容 |
|-----------|------|
| お出かけ | 外出適性・傘の必要性 |
| 洗濯 | 外干し / 室内干し判定 |
| 花粉・大気 | 季節と天気から飛散リスク推定 |
| 服装 | 気温別おすすめコーデ |
| UV・日焼け | 日差しの強さと対策 |
| 体調・健康 | 熱中症・凍結などのリスク |

---

### ニュース

- **ソース**: Yahoo Japan RSS（1次）→ Google News RSS（自動フォールバック）
- **15 カテゴリタブ**（横スクロール対応）

| カテゴリ | カテゴリ | カテゴリ |
|---------|---------|---------|
| トップ | 国内 | 国際 |
| 政治 | 経済 | テクノロジー |
| サイエンス | スポーツ | エンタメ |
| 健康 | ビジネス | グルメ |
| 旅行 | 地域 | 災害 |

**ニュース機能詳細**

| 機能 | 内容 |
|------|------|
| ブックマーク | 最大 50 件・クラウド同期 |
| 既読管理 | 最大 300 件・クラウド同期、未読のみ表示フィルター |
| バッジカウント | タブごとに未読件数を表示 |
| AI 要約 | Cloudflare Workers AI による記事要約（7日キャッシュ） |
| スワイプ操作 | 左スワイプ → 既読、右スワイプ → ブックマーク |
| 遅延ロード | IntersectionObserver で 6 件ずつ追加 |
| オフラインキャッシュ | localStorage に保存し圏外でも閲覧可能 |
| 15 分キャッシュ | 過剰なリクエストを抑制 |

---

### AI チャット（Luna & Elma）

- **モデル**: `@cf/meta/llama-3.1-8b-instruct`（Cloudflare Workers AI）
- 現在の天気データをコンテキストとして渡し、天気に関連した自然な日本語で応答
- 会話履歴を直近 10 件保持
- チャット履歴のローカル保存（最大 20 件）

---

### UI・演出

| 機能 | 内容 |
|------|------|
| テーマ | ダーク / ライト切替（OS 設定に自動対応） |
| フォントサイズ | 3 段階切替 |
| 単位 | 摂氏 ℃ / 華氏 ℉ |
| 背景グラデーション | 天気連動（晴れ・曇り・雨・雪・雷） |
| パーティクル | 雨・雪エフェクト（Canvas） |
| スケルトンローディング | 天気・ニュースカード |
| プルリフレッシュ | PTR（スマホ向けスワイプ更新） |
| 雨・雪バナー | 降水時に警告バナーを表示 |
| モバイル対応ヘッダー | 2 行レイアウト・44px タップターゲット |

---

### PWA

| 機能 | 内容 |
|------|------|
| Service Worker v3 | Stale-While-Revalidate（静的アセット）+ TTL キャッシュ（API） |
| インストール | ホーム画面追加プロンプト |
| オフライン対応 | キャッシュからフォールバック |
| Web Push 通知 | 天気アラート通知 |

**キャッシュ TTL**

| 対象 | TTL |
|------|-----|
| 天気 API | 10 分 |
| ニュース RSS | 15 分 |
| 静的アセット | Stale-While-Revalidate（即返却 + バックグラウンド更新） |

---

### 認証・クラウド同期（Supabase）

- メール / パスワード認証
- 以下の設定をクラウド同期

| 同期データ | 内容 |
|-----------|------|
| お気に入り都市 | 最大 10 件 |
| ニュースブックマーク | 最大 50 件 |
| 既読 URL | 最大 300 件 |
| テーマ・単位・音量 | UI 設定 |
| ニュースカテゴリ | 最後に見たタブ |
| 検索履歴 | 最大 8 件 |

---

## 使用技術・外部サービス

| 技術 / サービス | 用途 | 料金 |
|---------------|------|------|
| [OpenWeatherMap](https://openweathermap.org/) | 天気データ | 無料プラン（月 100 万件） |
| 気象庁（JMA）API | 週間予報 | 無料・公式 |
| Yahoo Japan RSS | ニュース 1 次ソース | 無料 |
| Google News RSS | ニュース フォールバック | 無料 |
| [rss2json.com](https://rss2json.com/) | RSS → JSON 変換（CORS 対応） | 無料プラン |
| [Cloudflare Workers AI](https://ai.cloudflare.com/) | AI チャット・記事要約 | 無料プラン |
| [Supabase](https://supabase.com/) | 認証・クラウド同期 | 無料プラン（Northeast Asia / Tokyo リージョン） |
| [GitHub Pages](https://pages.github.com/) | ホスティング | 無料 |
| Vanilla JS / HTML / CSS | フロントエンド | — |

---

## ファイル構成

```
Weather-2-App/
├── index.html          # UI・全 CSS
├── app.js              # フロントエンドロジック（天気・ニュース・チャット・PWA）
├── config.js           # APIキー・設定（公開リポジトリには含めない）
├── config.example.js   # config.js のテンプレート
├── supabase.js         # Supabase 認証・クラウド同期
├── sw.js               # Service Worker v3
├── manifest.json       # PWA マニフェスト
├── icon-192.svg        # PWA アイコン
├── privacy.html        # プライバシーポリシー
└── chat-worker/        # Cloudflare Workers バックエンド
    ├── src/
    │   └── index.js    # /api/chat・/api/summarize エンドポイント
    └── wrangler.toml   # Workers 設定
```

---

## ローカル環境での起動

```bash
git clone https://github.com/Yuuuki84/Weather-2-App.git
cd Weather-2-App
cp config.example.js config.js
# config.js に各 API キーを設定
```

`index.html` をブラウザで開く（Live Server 推奨）。

---

## 必要な API キー

| キー | 取得先 |
|------|--------|
| `OPENWEATHER_API_KEY` | [openweathermap.org/api](https://openweathermap.org/api) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | [supabase.com](https://supabase.com/) |
| `CHAT_API_URL` | Cloudflare Workers デプロイ後の URL |

> `config.js` は `.gitignore` で除外済みです。GitHub にコミットしないでください。

---

## Cloudflare Workers のデプロイ

```bash
cd chat-worker
npm install
npx wrangler deploy
```

デプロイ後に表示される URL を `config.js` の `CHAT_API_URL` に設定します。

---

## ブランチ運用

```
main        ← 本番（GitHub Pages に公開）
  └── develop     ← 開発集約
        └── feature/xxx  ← 機能・修正ごとの作業ブランチ
```

作業は必ず `feature/*` → `develop` → `main` の順でマージします。

---

## 実装履歴（主要変更）

| バージョン | 内容 |
|-----------|------|
| 初期 | 天気検索・Gemini AI アドバイス・GNews API ニュース |
| UX 改善 | キャッシュ永続化・PTR・バッジ・プライバシーポリシー・オンボーディング |
| ニュース刷新 | GNews/Currents/WorldNewsAPI を廃止 → Yahoo + Google RSS に移行 |
| モバイル対応 | 2 行ヘッダー・44px タップターゲット・設定ドロップダウン fixed 配置 |
| ニュース拡張 | 15 カテゴリタブ（横スクロール）・ブックマーク・既読・AI 要約 |
| 品質改善 | ブックマーク 2 重登録バグ修正・innerHTML 廃止・SW TTL NaN 修正 |

---

## ライセンス

MIT License

---

*Built with Claude (Anthropic)*
