const { requireAuth } = require('../../../lib/api-auth');
const { syncVidmolyDailyUsage } = require('../../../lib/apiKeyManager');

export default async function handler(req, res) {
  const session = requireAuth(req, res, { role: 'admin' });
  if (!session) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const keys = await syncVidmolyDailyUsage(req.body?.usage);
    return res.status(200).json({ keys, syncedAt: Date.now() });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر مزامنة استهلاك Vidmoly.' });
  }
}
