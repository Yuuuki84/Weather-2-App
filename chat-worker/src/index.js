// ===== Luna & Elma Chat Worker =====
// Cloudflare Workers バックエンド（Workers AI 使用）
// 環境変数 (wrangler.toml vars): ALLOWED_ORIGIN
// AI バインディング (wrangler.toml [ai]): AI

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const SYSTEM_PROMPT =
  'あなたは「Luna & Elma」という天気・ニュースアプリの明るいAIアシスタントです。' +
  '【重要】返答は必ず純粋な日本語のみで書いてください。英単語・英語フレーズは一切使わないでください。' +
  '例えば "warm up" は「気温が上がる」、"clear" は「晴れ」と日本語で書いてください。' +
  '天気データが提供された場合は、数値の羅列ではなく「今日は冷え込みますね」「風が強めです」のような自然な表現を使ってください。' +
  '返答は150〜200文字程度で、箇条書きは使わず自然な会話文で書いてください。';

export default {
  async fetch(request, env) {
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

    if (url.pathname !== '/api/chat' || request.method !== 'POST') {
      return jsonRes({ error: 'Not Found' }, 404, origin);
    }

    try {
      const { message, history = [], city, weather } = await request.json();
      if (!message?.trim()) return jsonRes({ error: 'message が必要です' }, 400, origin);

      const reply = await callWorkersAI(message, history, city, weather, env.AI);
      return jsonRes({ reply }, 200, origin);
    } catch (e) {
      console.error(e);
      return jsonRes({ error: e.message || '内部エラー' }, 500, origin);
    }
  },
};

async function callWorkersAI(message, history, city, weather, ai) {
  if (!ai) throw new Error('AI binding が未設定です（wrangler.toml に [ai] binding = "AI" を追加してください）');

  // 天気コンテキスト
  const weatherCtx = city && weather
    ? `\n\n【現在の天気情報】\n都市: ${city}\n天気: ${weather.desc}\n気温: ${weather.temp}℃\n体感: ${weather.feels}℃\n湿度: ${weather.humid}%\n風速: ${weather.wind}m/s`
    : '';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + weatherCtx },
    // 会話履歴（最大10ターン、role は user/assistant に変換）
    ...history.slice(-10).map(t => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.content,
    })),
    { role: 'user', content: message },
  ];

  const response = await ai.run(AI_MODEL, {
    messages,
    max_tokens: 350,
  });

  const text = response.response;
  if (!text) throw new Error('空のレスポンスが返りました');
  return text.trim();
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
