const { getSessionFromReq } = require('../../../lib/auth');
const { getSetting, saveSetting } = require('../../../lib/siteDb');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method === 'GET') {
    try {
      const items = await getSetting('sidebar_items', []);
      return res.status(200).json({ items });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { items } = req.body || {};
      if (!Array.isArray(items)) return res.status(400).json({ error: 'قائمة غير صالحة' });
      await saveSetting('sidebar_items', items);
      return res.status(200).json({ items });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end();
};
