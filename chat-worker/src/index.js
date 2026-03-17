// ===== Luna & Elma Worker =====
// Cloudflare Workers バックエンド
// Secrets: GNEWS_API_KEY
// AI バインディング (wrangler.toml [ai]): AI
// 環境変数 (wrangler.toml vars): ALLOWED_ORIGIN

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const NEWS_CACHE_TTL = 5 * 60; // 5分（秒）

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

const GNEWS_CATEGORY = {
  general: 'general', technology: 'technology', science: 'science',
  sports: 'sports', entertainment: 'entertainment', health: 'health', business: 'business',
};

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

// ===== ニュースキャッシュ =====
async function handleNews(url, origin, env, ctx) {
  const category = url.searchParams.get('category') || 'general';
  const cache = caches.default;
  const cacheKey = new Request(`https://luna-elma-cache.internal/news/${category}`);

  // キャッシュヒット確認
  const cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    return jsonRes(data, 200, origin);
  }

  // GNews から取得
  const data = await fetchGNews(category, env.GNEWS_API_KEY);
  if (data.error) return jsonRes(data, 502, origin);

  // キャッシュ保存（5分）
  const cacheRes = new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${NEWS_CACHE_TTL}` },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheRes));

  return jsonRes(data, 200, origin);
}

async function fetchGNews(category, apiKey) {
  if (!apiKey) return { error: 'GNEWS_API_KEY が未設定です' };
  let apiUrl;
  if (category === 'pet') {
    const q = encodeURIComponent('ペット 犬 猫');
    apiUrl = `https://gnews.io/api/v4/search?q=${q}&lang=ja&max=10&token=${apiKey}`;
  } else {
    const cat = GNEWS_CATEGORY[category] || 'general';
    apiUrl = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=ja&country=jp&max=10&token=${apiKey}`;
  }
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `GNews HTTP ${res.status}: ${body.slice(0, 80)}` };
    }
    return await res.json();
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
