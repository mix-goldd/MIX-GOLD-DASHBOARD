const { authenticateCronRequest } = require('../../../lib/manusCronAuth');
const { syncVidmolyPortalUsage, VidmolyPortalSyncError } = require('../../../lib/vidmolyPortalSync');
const { getDashboardSetting } = require('../../../lib/db');
const {
  VIDMOLY_HEARTBEAT_TASK_SETTING,
  isRegisteredHeartbeatTask,
} = require('../../../lib/vidmolyHeartbeatGuard');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const cronUser = await authenticateCronRequest(req);
    if (!cronUser?.isCron || !cronUser.taskUid) return res.status(403).json({ error: 'cron-only' });

    const registeredTaskUid = await getDashboardSetting(VIDMOLY_HEARTBEAT_TASK_SETTING);
    if (!isRegisteredHeartbeatTask(registeredTaskUid, cronUser.taskUid)) {
      return res.status(403).json({ error: 'unregistered-cron-task' });
    }

    const { sync } = await syncVidmolyPortalUsage();
    return res.status(200).json({ ok: true, taskUid: cronUser.taskUid, sync });
  } catch (error) {
    const safeError = error instanceof VidmolyPortalSyncError
      ? error.message
      : 'تعذرت مزامنة استهلاك Vidmoly المجدولة.';
    return res.status(500).json({
      error: safeError,
      context: { path: req.url || '/api/scheduled/vidmoly-usage' },
      timestamp: new Date().toISOString(),
    });
  }
}
