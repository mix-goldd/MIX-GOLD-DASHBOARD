const { requireAuth } = require('../../../lib/api-auth');
const { listUsers, createUser, getUserByUsername } = require('../../../lib/db');
const { hashPassword } = require('../../../lib/auth');

export default async function handler(req, res) {
  const session = requireAuth(req, res, { role: 'admin' });
  if (!session) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await listUsers());
    }

    if (req.method === 'POST') {
      const { username, password, role } = req.body || {};
      if (!username || !password || password.length < 8) {
        return res
          .status(400)
          .json({ error: 'Username and an 8+ character password are required.' });
      }
      if (await getUserByUsername(username)) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }
      const user = await createUser(username, hashPassword(password), role === 'admin' ? 'admin' : 'member');
      return res.status(201).json({ id: user.id, username: user.username, role: user.role });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
