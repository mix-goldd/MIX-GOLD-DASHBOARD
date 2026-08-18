const { requireAuth } = require('../../lib/api-auth');
const { listComments, deleteComment } = require('../../lib/siteDb');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const comments = await listComments(200);
      return res.status(200).json({ comments });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id is required.' });
      await deleteComment(id);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
