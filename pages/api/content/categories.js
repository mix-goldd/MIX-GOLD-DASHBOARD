const { getSessionFromReq } = require('../../../lib/auth');
const { getSetting, saveSetting } = require('../../../lib/siteDb');

const DEFAULT_CATEGORIES = ['Shonen', 'Seinen', 'Shojo', 'Isekai', 'Mecha', 'Slice of Life'];

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method === 'GET') {
    try {
      const categories = await getSetting('video_categories', DEFAULT_CATEGORIES);
      return res.status(200).json({ categories });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { categories } = req.body || {};
      if (!Array.isArray(categories)) return res.status(400).json({ error: 'قائمة غير صالحة' });
      await saveSetting('video_categories', categories);
      return res.status(200).json({ categories });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end();
};
