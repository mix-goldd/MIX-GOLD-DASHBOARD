const { getSessionFromReq } = require('./auth');

// Call at the top of any /api route that needs a logged-in user.
// Pass { role: 'admin' } to also require a specific role.
// Writes the response and returns null if the check fails —
// the caller should just `return` when it gets null back.
function requireAuth(req, res, opts = {}) {
  const session = getSessionFromReq(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return null;
  }
  if (opts.role && session.role !== opts.role) {
    res.status(403).json({ error: "You don't have permission to do that." });
    return null;
  }
  return session;
}

module.exports = { requireAuth };
