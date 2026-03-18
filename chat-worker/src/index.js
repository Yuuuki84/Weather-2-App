// ===== Luna & Elma Worker =====
// Cloudflare Workers バックエンド
// Secrets: WORLDNEWS_API_KEY
// AI バインディング (wrangler.toml [ai]): AI
// 環境変数 (wrangler.toml vars): ALLOWED_ORIGIN

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const NEWS_CACHE_TTL = 5 * 60; // 5分（秒）

// WorldNewsAPI カテゴリ → 検索キーワード
const WORLDNEWS_QUERY = {
  general:       null, // top-news エンドポイント使用
  technology:    'テクノロジー OR IT OR 人工知能 OR AI',
  science:       '科学 OR 研究 OR 宇宙',
  sports:        'スポーツ OR サッカー OR 野球 OR テニス',
  entertainment: 'エンタメ OR 芸能 OR 映画 OR 音楽',
  health:        '健康 OR 医療 OR 病気 OR 薬',
  business:      'ビジネス OR 経済 OR 株 OR 企業',
  disaster:      '災害 OR 地震 OR 台風 OR 洪水 OR 津波',
};

const SYSTEM_PROMPT =
  'あなたは「Luna & Elma」という天気・ニュースアプリの明るいAIアシスタントです。' +
  '【重要】返答は必ず純粋な日本語のみで書いてください。英単語・英語フレーズは一切使わないでください。' +
  '例えば "warm up" は「気温が上がる」、"clear" は「晴れ」と日本語で書いてください。' +
  '天気データが提供された場合は、数値の羅列ではなく「今日は冷え込みますね」「風が強めです」のような自然な表現を使ってください。' +
  '返答は150〜200文字程度で、箇条書きは使わず自然な会話文で書いてください。';

const SUMMARIZE_PROMPT =
  'あなたはニュース記事の要約専門家です。' +
  '【厳守】返答は必ず純粋な日本語のみで書いてください。' +
  '英単語・記号（*、-、#、>、「」以外の括弧など）・箇条書き・見出しは一切使わないでください。' +
  '2〜3文の自然な会話文のみで要約してください。改行も使わないでください。';


export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOWED_ORIGIN || '*';

    // CORS プリフライト
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    // ヘルスチェック
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // ニュース API
    if (url.pathname === '/api/news' && request.method === 'GET') {
      return handleNews(url, origin, env, ctx);
    }

    // 要約 API
    if (url.pathname === '/api/summarize' && request.method === 'POST') {
      try {
        const { title, description } = await request.json();
        if (!title?.trim()) return jsonRes({ error: 'title が必要です' }, 400, origin);
        const summary = await callSummarizeAI(title, description, env.AI);
        return jsonRes({ summary }, 200, origin);
      } catch (e) {
        console.error(e);
        return jsonRes({ error: e.message || '内部エラー' }, 500, origin);
      }
    }

    // チャット API
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const { message, history = [], city, weather } = await request.json();
        if (!message?.trim()) return jsonRes({ error: 'message が必要です' }, 400, origin);
        const reply = await callWorkersAI(message, history, city, weather, env.AI);
        return jsonRes({ reply }, 200, origin);
      } catch (e) {
        console.error(e);
        return jsonRes({ error: e.message || '内部エラー' }, 500, origin);
      }
    }

    return jsonRes({ error: 'Not Found' }, 404, origin);
  },
};

// ===== WorldNewsAPI ニュース取得 =====
async function handleNews(url, origin, env, ctx) {
  const category = url.searchParams.get('category') || 'general';
  const cache = caches.default;
  const cacheKey = new Request(`https://luna-elma-cache.internal/news/wn/${category}`);

  const cached = await cache.match(cacheKey);
  if (cached) return jsonRes(await cached.json(), 200, origin);

  const data = await fetchWorldNews(category, env.WORLDNEWS_API_KEY);
  if (data.error) return jsonRes(data, 502, origin);

  ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${NEWS_CACHE_TTL}` },
  })));
  return jsonRes(data, 200, origin);
}

async function fetchWorldNews(category, apiKey) {
  if (!apiKey) return { error: 'WORLDNEWS_API_KEY が未設定です' };
  try {
    const query = WORLDNEWS_QUERY[category];
    let apiUrl;
    if (!query) {
      // general: top-news（日本語・日本）
      apiUrl = `https://api.worldnewsapi.com/top-news?source-country=jp&language=ja&api-key=${apiKey}`;
    } else {
      apiUrl = `https://api.worldnewsapi.com/search-news?language=ja&text=${encodeURIComponent(query)}&sort=publish-time&sort-direction=DESC&number=20&api-key=${apiKey}`;
    }
    const res = await fetch(apiUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `WorldNews HTTP ${res.status}: ${body.slice(0, 80)}` };
    }
    const json = await res.json();

    // top-news と search-news でレスポンス形式が異なる
    let rawItems = [];
    if (json.top_news) {
      rawItems = json.top_news.flatMap(g => g.news || []);
    } else if (json.news) {
      rawItems = json.news;
    }
    if (!rawItems.length) return { error: '記事なし' };

    const articles = rawItems.slice(0, 20).map(item => ({
      title:       item.title || '',
      description: item.text ? item.text.slice(0, 200) : '',
      url:         item.url || '',
      image:       item.image || '',
      publishedAt: item.publish_date || '',
      source:      { name: item.source_url ? new URL(item.source_url).hostname.replace('www.', '') : 'WorldNews' },
    }));
    return { articles };
  } catch (e) {
    return { error: e.message || 'fetch失敗' };
  }
}

// ===== Workers AI 要約 =====
async function callSummarizeAI(title, description, ai) {
  if (!ai) throw new Error('AI binding が未設定です');
  const messages = [
    { role: 'system', content: SUMMARIZE_PROMPT },
    { role: 'user', content: `タイトル: ${title}\n本文抜粋: ${description || 'なし'}\n\n上記を2〜3文の日本語で要約してください。` },
  ];
  const response = await ai.run(AI_MODEL, { messages, max_tokens: 200 });
  const text = response.response;
  if (!text) throw new Error('空のレスポンスが返りました');
  return text.trim();
}

// ===== Workers AI チャット =====
async function callWorkersAI(message, history, city, weather, ai) {
  if (!ai) throw new Error('AI binding が未設定です');

  const weatherCtx = city && weather
    ? `\n\n【現在の天気情報】\n都市: ${city}\n天気: ${weather.desc}\n気温: ${weather.temp}℃\n体感: ${weather.feels}℃\n湿度: ${weather.humid}%\n風速: ${weather.wind}m/s`
    : '';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + weatherCtx },
    ...history.slice(-10).map(t => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.content,
    })),
    { role: 'user', content: message },
  ];

  const response = await ai.run(AI_MODEL, { messages, max_tokens: 350 });
  const text = response.response;
  if (!text) throw new Error('空のレスポンスが返りました');
  return text.trim();
}

// ===== CORS / JSON ヘルパー =====
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonRes(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
