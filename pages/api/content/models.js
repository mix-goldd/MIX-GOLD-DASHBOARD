const { getSessionFromReq } = require('../../../lib/auth');
const { listModels, createModel } = require('../../../lib/siteDb');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method === 'GET') {
    try {
      const models = await listModels();
      return res.status(200).json({ models });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const name = (body.name || body.title || '').trim();
      const thumbnailUrl = (body.thumbnail_url || '').trim();
      if (!name || !thumbnailUrl) {
        return res.status(400).json({ error: 'الاسم وصورة الغلاف مطلوبان' });
      }

      const model = {
        name,
        thumbnail_url: thumbnailUrl,
        category: (body.category || '').trim() || 'model',
        subs: (body.subs || '0').toString().trim() || '0',
        likes: (body.likes || '0').toString().trim() || '0',
      };

      const created = await createModel(model);
      return res.status(200).json({ model: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end();
};
