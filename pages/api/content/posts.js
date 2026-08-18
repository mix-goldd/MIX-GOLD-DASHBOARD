const { getSessionFromReq } = require('../../../lib/auth');
const { listPosts, createPost } = require('../../../lib/siteDb');

const ALLOWED_TYPES = ['video', 'image', 'manga', 'model'];

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method === 'GET') {
    try {
      const posts = await listPosts();
      return res.status(200).json({ posts });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
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

      const post = {
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
        views: 0,
      };

      const created = await createPost(post);
      return res.status(200).json({ post: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end();
};
