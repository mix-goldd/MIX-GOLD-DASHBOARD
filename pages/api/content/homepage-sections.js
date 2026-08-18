const { getSessionFromReq } = require('../../../lib/auth');
const { getSetting, saveSetting } = require('../../../lib/siteDb');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method === 'GET') {
    try {
      const sections = await getSetting('homepage_sections', {});
      return res.status(200).json({ sections });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { sections } = req.body || {};
      if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
        return res.status(400).json({ error: 'بيانات غير صالحة' });
      }
      await saveSetting('homepage_sections', sections);
      return res.status(200).json({ sections });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end();
};
