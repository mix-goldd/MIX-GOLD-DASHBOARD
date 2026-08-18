const { getSessionFromReq } = require('../../../lib/auth');
const { getSetting, saveSetting } = require('../../../lib/siteDb');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method === 'GET') {
    try {
      const locks = await getSetting('nav_locks', {});
      return res.status(200).json({ locks });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { locks } = req.body || {};
      if (!locks || typeof locks !== 'object' || Array.isArray(locks)) {
        return res.status(400).json({ error: 'بيانات غير صالحة' });
      }
      await saveSetting('nav_locks', locks);
      return res.status(200).json({ locks });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end();
};
