// Minimal Gemini REST client — plain fetch, no SDK. Same reasoning as
// lib/vidmoly.js: a thin wrapper means a failure surfaces the real HTTP
// status and response body directly, which is far easier to debug from a
// screenshot than an SDK exception's own (often reshaped) error message.
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Matches the model string Google AI Studio's own "Get code" panel
// generated for this account — not a version number picked from memory.
const MODEL = 'gemini-flash-latest';
const { getNextApiKey, recordApiOutcome } = require('./apiKeyManager');

async function callGemini(body, opts = {}) {
  const url = `${API_BASE}/models/${opts.model || MODEL}:generateContent`;
  const credential = await getNextApiKey('gemini');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': credential.value },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Gemini API request failed to connect: ${err.message}`);
  }
  const bodyText = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch (err) {
    await recordApiOutcome({ provider: 'gemini', keyId: credential.id, httpStatus: res.status, retryAfter: res.headers.get('retry-after') });
    throw new Error(`Gemini API returned non-JSON: ${bodyText.slice(0, 500)}`);
  }
  await recordApiOutcome({
    provider: 'gemini',
    keyId: credential.id,
    httpStatus: res.status,
    retryAfter: res.headers.get('retry-after'),
    providerPayload: payload,
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Gemini's API quota is exhausted for now. The affected key has been paused using Retry-After; check the dashboard timer before trying again.");
    }
    throw new Error(`Gemini API request failed (${res.status}): ${bodyText.slice(0, 500)}`);
  }
  return payload;
}

// Single-turn, text (+ optional image) in, text out — used by
// generate-metadata.js. Kept separate from generateChat below so that
// already-working call site never has to change shape.
async function generateContent(parts, opts = {}) {
  const data = await callGemini(
    {
      contents: [{ parts }],
      ...(opts.generationConfig ? { generationConfig: opts.generationConfig } : {}),
    },
    opts
  );
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return { text, raw: data };
}

// Multi-turn conversation with optional function-calling tools — used by
// the AI chat assistant (pages/api/ai/chat.js). `contents` is the full
// [{role, parts}] history including this turn's new message; the model
// may respond with text, one or more functionCall parts, or both.
async function generateChat(contents, opts = {}) {
  const data = await callGemini(
    {
      contents,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.systemInstruction ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } } : {}),
      ...(opts.generationConfig ? { generationConfig: opts.generationConfig } : {}),
    },
    opts
  );
  return { candidate: data.candidates?.[0], raw: data };
}

module.exports = { generateContent, generateChat };
