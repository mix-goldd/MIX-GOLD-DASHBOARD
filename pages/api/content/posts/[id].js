const { getSessionFromReq } = require('../../../../lib/auth');
const { deletePost, updatePost } = require('../../../../lib/siteDb');

const ALLOWED_TYPES = ['video', 'image', 'manga', 'model'];

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  const { id } = req.query;

  if (req.method === 'PUT') {
    try {
      const body = req.body || {};
      const type = ALLOWED_TYPES.includes(body.type) ? body.type : 'video';
      const title = (body.title || '').trim();
      const thumbnailUrl = (body.thumbnail_url || '').trim();
      if (!title || !thumbnailUrl) {
        return res.status(400).json({ error: 'العنوان وصورة الغلاف مطلوبان' });
      }

      const description = (body.description ?? body.synopsis ?? '').toString().trim() || null;
      const modelId = (body.model_id || '').toString().trim() || null;
      const categories = type === 'video' && Array.isArray(body.categories)
        ? body.categories.map((c) => (c || '').toString().trim()).filter(Boolean)
        : [];

      const patch = {
        type,
        title,
        thumbnail_url: thumbnailUrl,
        page_url: (body.page_url || '').trim() || null,
        download_url: (body.download_url || body.page_url || '').trim() || null,
        category: categories[0] || null,
        categories: type === 'video' ? categories : null,
        studio: (body.studio || '').trim() || null,
        series: (body.series || '').trim() || null,
        duration: (body.duration || '').trim() || null,
        model_id: modelId,
        description,
        images: type === 'image' ? [thumbnailUrl] : null,
      };

      const updated = await updatePost(id, patch);
      return res.status(200).json({ post: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await deletePost(id);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return res.status(405).end();
};
