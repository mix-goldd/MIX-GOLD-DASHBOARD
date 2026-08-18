const { requireAuth } = require('../../../lib/api-auth');
const { getDashboardSetting } = require('../../../lib/db');
const { findVidmolyLibraryMatch } = require('../../../lib/vidmolyLibraryMatch');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const title = String(req.query.title || req.body?.title || '').trim();
  if (!title) {
    return res.status(400).json({ error: 'Title is required.' });
  }

  try {
    const storedSnapshot = await getDashboardSetting('vidmoly_library_snapshot_v1');
    const snapshotPayload = storedSnapshot?.payload || null;
    if (!snapshotPayload) {
      return res.status(409).json({
        error: 'لا توجد لقطة مكتبة محفوظة بعد. افتح صفحة الفيديوهات أو حدّثها مرة واحدة أولاً.',
      });
    }

    const result = findVidmolyLibraryMatch(title, snapshotPayload);
    if (!result) {
      return res.status(404).json({ error: 'لم يُعثر على فيديو Vidmoly مطابق في المكتبة المحفوظة.' });
    }

    return res.status(200).json({
      status: 200,
      result,
      cache: { cachedAt: Number(storedSnapshot.cachedAt) || null },
    });
  } catch (err) {
    return res.status(502).json({ error: 'تعذر قراءة مكتبة Vidmoly المحفوظة الآن.' });
  }
}
