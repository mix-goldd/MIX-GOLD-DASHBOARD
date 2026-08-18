// Suggests a title + description from a post's cover image via Gemini.
// Never writes anything itself — the frontend fills the form fields with
// whatever comes back so the editor can still change or reject it before
// saving, same as every other field on this page.
const { requireAuth } = require('../../../lib/api-auth');
const gemini = require('../../../lib/gemini');
const { getSetting } = require('../../../lib/siteDb');
const { POST_TYPES } = require('../../../lib/animeContent');

async function imageToInlineData(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Could not fetch the cover image: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Could not fetch the cover image (${res.status}).`);
  }
  const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime_type: contentType, data: buf.toString('base64') };
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image_url, existing_title, type } = req.body || {};
  if (!image_url) {
    return res.status(400).json({ error: 'A cover image is required to generate a title and description.' });
  }

  try {
    const image = await imageToInlineData(image_url);
    // Was hardcoded to a guessed set of type keys (anime/manga/movie/
    // series) that never actually matched this project's real values
    // (video/image/manga/model — see lib/animeContent.js's POST_TYPES) —
    // silently always fell back to the generic "محتوى" label. Reads the
    // same settings-backed list content.js's dropdown uses instead, so
    // it also picks up any custom types added on /dashboard/settings.
    const contentTypes = await getSetting('content_types', POST_TYPES);
    const kindLabel = contentTypes.find((t) => t.value === type)?.label || 'محتوى';
    const prompt =
      `انت محرر محتوى لموقع ${kindLabel}. بناءً على صورة الغلاف المرفقة` +
      (existing_title ? ` والعنوان الحالي "${existing_title}"` : '') +
      `، اقترح عنوانًا جذابًا ووصفًا قصيرًا (2-3 جمل) بالعربية الفصحى المبسطة. ` +
      `رد بصيغة JSON فقط بدون أي نص أو تنسيق إضافي، بالضبط بهذا الشكل: {"title": "...", "description": "..."}`;

    const { text } = await gemini.generateContent([{ text: prompt }, { inline_data: image }]);

    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return res.status(502).json({ error: "Gemini's response wasn't valid JSON — see the raw text below.", raw: text });
    }

    if (!parsed.title && !parsed.description) {
      return res.status(502).json({ error: "Gemini's response didn't include a title or description.", raw: text });
    }

    res.status(200).json({ title: parsed.title || '', description: parsed.description || '' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
