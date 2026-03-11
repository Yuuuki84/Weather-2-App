# 🌤 Luna & Elma — 天気 & ニュースアプリ

シンプルで美しい天気 + ニュース Webアプリです。
都市名または現在地から最新の天気情報を取得し、リアルタイムニュースと **Gemini AI によるパーソナライズアドバイス** を表示します。

**🔗 公開URL:** https://yuuuki84.github.io/Weather-2-App/

---

## ✨ 機能一覧

### 🌡 天気機能
- 都市名検索（日本語・英語対応）
- 現在地取得（GPSボタン）
- オートコンプリート（国内外の主要都市）
- 検索履歴（最大8件・ローカル保存）
- URL共有（`?city=都市名` パラメータ）

### 📊 表示情報
| 項目 | 内容 |
|------|------|
| 気温 | 現在・体感・最低/最高 |
| 天気 | アイコン + 日本語説明 |
| 湿度 | % |
| 風速・風向 | m/s（または mph） + 16方位 |
| 気圧 | hPa |
| 視程 | km |
| 雲量 | % |
| 雨量・雪量 | mm/h |
| 日の出・日の入 | 現地時刻 |
| 緯度・経度 | 座標 |

### 🎯 天気アドバイス（6項目・ルールベース）
天気・気温・季節をもとに自動生成される生活アドバイスです。

| アドバイス | 内容 |
|-----------|------|
| 🚶 お出かけ | 外出適性・傘の必要性 |
| 👔 洗濯 | 外干し/室内干し判定 |
| 🌸 花粉・大気 | 季節と天気から飛散リスク推定 |
| 👗 服装 | 気温別おすすめコーデ |
| ☀️ UV・日焼け | 日差しの強さと対策 |
| 💪 体調・健康 | 熱中症・凍結などのリスク |

### ✨ Gemini AI アドバイス
天気データを **Google Gemini** に送信し、自然な日本語で生成されるパーソナライズアドバイス。

- モデル: `gemini-2.0-flash-lite` → `gemini-2.0-flash` → `gemini-2.0-flash-exp`（自動フォールバック）
- ロード中アニメーション・エラー時フォールバックメッセージ対応

### 📰 ニュース機能
- **GNews API** を使用（日本語・国内ニュース）
- 7カテゴリ対応：トップ / テクノロジー / サイエンス / スポーツ / エンタメ / ヘルス / ビジネス
- 15分キャッシュで効率的なAPIアクセス
- ニュースカード：featured 2枚 + grid 最大18枚

### 🎨 UI・演出
- ダーク / ライトテーマ切替（OS設定に自動対応）
- 摂氏 ℃ / 華氏 ℉ 切替
- 天気連動の動的背景グラデーション（晴れ・曇り・雨・雪・雷）
- 雨・雪のパーティクルエフェクト（Canvas）
- スケルトンローディング

---

## 🛠 使用技術・API

<!-- AUTO-UPDATED:API_TABLE -->
| 技術/サービス | 用途 | 料金 |
|-------------|------|------|
| [OpenWeatherMap](https://openweathermap.org/) | 天気データ取得 | 無料プラン（月100万件） |
| [GNews API](https://gnews.io/) | 日本語ニュース取得 | 無料プラン（100件/日） |
| [Google Gemini API](https://aistudio.google.com/) | AI天気アドバイス生成 | 無料プラン（1500件/日） |
| HTML / CSS / Vanilla JS | フロントエンド | — |
| [GitHub Pages](https://pages.github.com/) | ホスティング | 無料 |
| Google Fonts (DM Sans, Syne) | フォント | 無料 |
<!-- /AUTO-UPDATED:API_TABLE -->

---

## 📁 ファイル構成

<!-- AUTO-UPDATED:FILE_TREE -->
```
Weather-2-App/
├── index.html      # UI・スタイル（全CSS含む）
├── app.js          # ロジック（天気・ニュース・Gemini AI・アドバイス）
├── .env            # APIキー（ローカル専用・GitHubには非公開）
├── .gitignore      # .env を除外
└── README.md       # このファイル
```
<!-- /AUTO-UPDATED:FILE_TREE -->

---

## 🚀 ローカルで動かす方法

1. リポジトリをクローン
   ```bash
   git clone https://github.com/Yuuuki84/Weather-2-App.git
   cd Weather-2-App
   ```

2. APIキーを設定（`app.js` の上部）
   ```js
   const WEATHER_API_KEY = 'あなたのOpenWeatherMap APIキー';
   const GEMINI_API_KEY  = 'あなたのGemini APIキー';
   ```

3. `index.html` をブラウザで開く（またはLive Serverなどで起動）

---

## 🔑 APIキーについて

### OpenWeatherMap（天気）
- [openweathermap.org/api](https://openweathermap.org/api) でサインアップ → 無料APIキーを取得
- `app.js` の `WEATHER_API_KEY` に設定

### GNews API（ニュース）
- [gnews.io](https://gnews.io/) でサインアップ → 無料APIキーを取得
- `app.js` の `GNEWS_API_KEY` に設定
- 無料プラン：100件/日（UTC 00:00 リセット）

### Google Gemini API（AI アドバイス）
- [aistudio.google.com](https://aistudio.google.com/) でAPIキーを取得
- `app.js` の `GEMINI_API_KEY` に設定
- ⚠️ `.env` にキーを保存し、**GitHubにはコミットしない**

---

## 📝 カスタマイズ

### 都市のオートコンプリート候補を追加
`app.js` の `POPULAR_CITIES` 配列に都市名を追加するだけです：
```js
const POPULAR_CITIES = [
  '東京', '大阪', '京都', '福岡', /* ← ここに追加 */
  ...
];
```

---

## 📄 ライセンス

MIT License — 自由に改変・再利用可能です。

---

*Built with ❤️ using Claude (Anthropic)*
