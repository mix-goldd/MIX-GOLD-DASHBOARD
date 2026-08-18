const { requireAuth } = require('../../../lib/api-auth');
const {
  listNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
} = require('../../../lib/db');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const [notifications, unreadCount] = await Promise.all([
        listNotifications(30),
        countUnreadNotifications(),
      ]);
      return res.status(200).json({ notifications, unreadCount });
    }

    if (req.method === 'PATCH') {
      await markAllNotificationsRead();
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (id) {
        await deleteNotification(id);
      } else {
        await deleteAllNotifications();
      }
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
