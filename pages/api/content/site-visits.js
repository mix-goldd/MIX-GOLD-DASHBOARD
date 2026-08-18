const { getSessionFromReq } = require('../../../lib/auth');
const { listSiteVisits } = require('../../../lib/siteDb');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end();
  }

  try {
    const visits = await listSiteVisits();
    return res.status(200).json({ visits });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
