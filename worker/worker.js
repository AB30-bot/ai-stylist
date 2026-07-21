/* =========================================================================
   AI Stylist — Cloudflare Worker proxy.

   Purpose: keep the Gemini API key SECRET. The website (on GitHub Pages) sends
   its request here; this Worker adds the key from a private Cloudflare secret
   (env.GEMINI_KEY) and forwards it to Google. The key is never in the website,
   never in this repo, never visible to users.

   Deploy:  wrangler deploy
   Secret:  wrangler secret put GEMINI_KEY     (you paste your key — I never see it)
   ========================================================================= */

// Only allow the real site to use this proxy (stops randoms from burning the key).
const ALLOWED_ORIGIN = 'https://ab30-bot.github.io';

// Only these models are allowed through, so a caller can't request an expensive one.
const MODEL_ALLOWLIST = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
const DEFAULT_MODEL = 'gemini-2.0-flash';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST')    return cors(json({ error: 'POST only' }, 405));

    let body;
    try { body = await request.json(); }
    catch { return cors(json({ error: 'invalid JSON' }, 400)); }

    const model = MODEL_ALLOWLIST.includes(body.model) ? body.model : DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_KEY}`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: body.contents,
        generationConfig: body.generationConfig,
      }),
    });

    const text = await upstream.text();
    return cors(new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    }));
  },
};

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
