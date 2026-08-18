const { requireAuth } = require('../../../lib/api-auth');
const { syncVidmolyPortalUsage, VidmolyPortalSyncError } = require('../../../lib/vidmolyPortalSync');

export default async function handler(req, res) {
  const session = requireAuth(req, res, { role: 'admin' });
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { keys, sync } = await syncVidmolyPortalUsage();
    return res.status(200).json({ keys, sync });
  } catch (error) {
    const message = error instanceof VidmolyPortalSyncError
      ? error.message
      : 'تعذرت مزامنة استهلاك Vidmoly تلقائياً.';
    return res.status(502).json({ error: message });
  }
}
