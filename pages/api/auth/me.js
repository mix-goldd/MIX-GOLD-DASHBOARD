const { getSessionFromReq } = require('../../../lib/auth');

export default function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  res.status(200).json(session);
}
