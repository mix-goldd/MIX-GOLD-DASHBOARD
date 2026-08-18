const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { page, per_page, fld_id, search } = req.query;

    if (search) {
      const data = await vidmoly.searchFiles(search);
      return res.status(200).json(data);
    }

    const data = await vidmoly.listFiles({
      ...(page ? { page } : {}),
      ...(per_page ? { per_page } : {}),
      ...(fld_id ? { fld_id } : {}),
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
