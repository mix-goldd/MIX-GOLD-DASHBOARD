// One-time bootstrap endpoint: creates the very first admin account.
// Refuses once any account already exists, so it's safe to leave in place.
const { countUsers, createUser, getUserByUsername } = require('../../../lib/db');
const { hashPassword, createSessionCookie } = require('../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const existing = await countUsers();
    if (existing > 0) {
      return res.status(403).json({ error: 'Setup has already been completed.' });
    }

    const { username, password } = req.body || {};
    if (!username || !password || password.length < 8) {
      return res
        .status(400)
        .json({ error: 'Username and an 8+ character password are required.' });
    }
    if (await getUserByUsername(username)) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const user = await createUser(username, hashPassword(password), 'admin');
    res.setHeader('Set-Cookie', createSessionCookie(user));
    res.status(201).json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
