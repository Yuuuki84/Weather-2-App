// ===== Luna & Elma Chat Worker =====
// Cloudflare Workers バックエンド
// 必要な Secrets: GEMINI_API_KEY
// 環境変数 (wrangler.toml vars): ALLOWED_ORIGIN

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=';

const SYSTEM_PROMPT =
  'あなたは「Luna & Elma」という天気・ニュースアプリの親しみやすいAIアシスタントです。' +
  'ユーザーの天気・ニュース・日常の質問に丁寧かつ明るい口調で答えてください。' +
  '返答は200文字以内を目安に、簡潔にまとめてください。箇条書きは使わず自然な文章で。';

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

      const reply = await callGemini(message, history, city, weather, env.GEMINI_API_KEY);
      return jsonRes({ reply }, 200, origin);
    } catch (e) {
      console.error(e);
      return jsonRes({ error: e.message || '内部エラー' }, 500, origin);
    }
  },
};

async function callGemini(message, history, city, weather, apiKey) {
  if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です');

  // 天気コンテキスト
  const weatherCtx = city && weather
    ? `\n\n【現在の天気情報】\n都市: ${city}\n天気: ${weather.desc}\n気温: ${weather.temp}℃\n体感: ${weather.feels}℃\n湿度: ${weather.humid}%\n風速: ${weather.wind}m/s`
    : '';

  // 会話履歴（最大10ターン）
  const contents = [];

  // システムプロンプトを最初のユーザーメッセージに埋め込む
  const sysWithCtx = SYSTEM_PROMPT + weatherCtx;

  // 履歴を追加（先頭はシステムプロンプト付きのユーザーメッセージ）
  history.slice(-10).forEach((turn, i) => {
    if (i === 0) {
      contents.push({ role: 'user', parts: [{ text: sysWithCtx + '\n\n' + turn.content }] });
    } else {
      contents.push({ role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turn.content }] });
    }
  });

  // 今回のメッセージ
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: sysWithCtx + '\n\n' + message }] });
  } else {
    contents.push({ role: 'user', parts: [{ text: message }] });
  }

  const res = await fetch(GEMINI_URL + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.8, maxOutputTokens: 350 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Gemini HTTP ' + res.status + ': ' + body.slice(0, 100));
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
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
