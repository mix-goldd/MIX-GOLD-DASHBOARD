const { requireAuth } = require('../../../lib/api-auth');
const { updateUserRole, deleteUser } = require('../../../lib/db');

export default async function handler(req, res) {
  const session = requireAuth(req, res, { role: 'admin' });
  if (!session) return;

  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const { role } = req.body || {};
      if (!['admin', 'member'].includes(role)) {
        return res.status(400).json({ error: 'Role must be admin or member.' });
      }
      const user = await updateUserRole(id, role);
      return res.status(200).json(user);
    }

    if (req.method === 'DELETE') {
      if (Number(id) === session.id) {
        return res.status(400).json({ error: "You can't remove your own account." });
      }
      await deleteUser(id);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
