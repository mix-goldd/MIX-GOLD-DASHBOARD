const { getSessionFromReq } = require('../../../../lib/auth');
const { updateModel, deleteModel } = require('../../../../lib/siteDb');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  const { id } = req.query;

  if (req.method === 'PUT') {
    try {
      const body = req.body || {};
      const name = (body.name || body.title || '').trim();
      const thumbnailUrl = (body.thumbnail_url || '').trim();
      if (!name || !thumbnailUrl) {
        return res.status(400).json({ error: 'الاسم وصورة الغلاف مطلوبان' });
      }

      const patch = {
        name,
        thumbnail_url: thumbnailUrl,
      };
      if (body.category !== undefined) patch.category = (body.category || '').trim() || 'model';
      if (body.subs !== undefined) patch.subs = (body.subs || '0').toString().trim() || '0';
      if (body.likes !== undefined) patch.likes = (body.likes || '0').toString().trim() || '0';

      const updated = await updateModel(id, patch);
      return res.status(200).json({ model: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await deleteModel(id);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return res.status(405).end();
};
