const { requireAuth } = require('../../../lib/api-auth');
const { getPublicApiKeyStatus } = require('../../../lib/apiKeyManager');
const { getVidmolyPortalSyncStatus } = require('../../../lib/vidmolyPortalSync');

export default async function handler(req, res) {
  const session = requireAuth(req, res, { role: 'admin' });
  if (!session) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const now = Date.now();
    const [keys, vidmolyPortalSync] = await Promise.all([
      getPublicApiKeyStatus(now),
      getVidmolyPortalSyncStatus(),
    ]);
    return res.status(200).json({ keys, vidmolyPortalSync, serverNow: now });
  } catch (err) {
    return res.status(500).json({ error: 'تعذر تحميل حالة مفاتيح API.' });
  }
}
