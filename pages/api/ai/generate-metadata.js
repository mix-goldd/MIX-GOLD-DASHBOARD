const { requireAuth } = require('../../../lib/api-auth');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(410).json({
    error: 'توليد العنوان والوصف تلقائيًا غير متاح. استخدم منفذ الأوامر المحلي لتجهيز بيانات الفيديو، ثم عدّل النص يدويًا.',
  });
}
