// ===== Luna & Elma Worker =====
// Cloudflare Workers バックエンド
// Secrets: （現在なし）
// AI バインディング (wrangler.toml [ai]): AI
// 環境変数 (wrangler.toml vars): ALLOWED_ORIGIN
// ニュースはクライアント側で 毎日新聞RSS → Yahoo RSS → Google RSS から直接取得

const AI_MODEL = '@cf/qwen/qwen1.5-14b-chat-awq';

const SYSTEM_PROMPT =
  'あなたは「Luna & Elma」という天気・ニュースアプリのAIアシスタントです。' +
  '必ず自然な日本語で返答してください。英単語・英語フレーズは使わないでください。' +
  '語尾は「〜ですね」「〜でしょう」「〜ます」など敬語を基本とし、同じ語尾を連続して使わないでください。' +
  '天気の説明は「冷え込みそうです」「雨が降りやすい一日です」のように端的で自然な表現にしてください。' +
  '返答は150〜200文字程度で、箇条書きは使わず会話文で書いてください。';

const SUMMARIZE_PROMPT =
  'あなたはニュース記事の要約専門家です。' +
  '必ず自然な日本語のみで返答してください。' +
  '英単語・記号（*、-、#、>、「」以外の括弧など）・箇条書き・見出しは使わないでください。' +
  '2〜3文の簡潔な会話文のみで要約してください。改行は使わないでください。';


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
