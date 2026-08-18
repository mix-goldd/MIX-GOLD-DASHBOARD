const { getSessionFromReq } = require('../../../lib/auth');
const { listMediaItems, deleteMediaItem, renameMediaItem } = require('../../../lib/siteDb');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method === 'GET') {
    try {
      const items = await listMediaItems();
      return res.status(200).json({ items });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const id = (req.query.id || (req.body && req.body.id) || '').toString();
      const name = ((req.body && req.body.name) || '').toString().trim();
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
      const items = await renameMediaItem(id, name);
      return res.status(200).json({ items });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const id = (req.query.id || '').toString();
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      const items = await deleteMediaItem(id);
      return res.status(200).json({ items });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
  return res.status(405).end();
};
