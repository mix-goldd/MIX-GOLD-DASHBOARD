const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const data = await vidmoly.accountInfo();
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
