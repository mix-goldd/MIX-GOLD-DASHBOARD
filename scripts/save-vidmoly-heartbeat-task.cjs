const { saveDashboardSetting } = require('../lib/db');
const { VIDMOLY_HEARTBEAT_TASK_SETTING } = require('../lib/vidmolyHeartbeatGuard');

async function main() {
  const taskUid = String(process.argv[2] || '').trim();
  if (!taskUid || !/^[-_a-zA-Z0-9]+$/.test(taskUid)) {
    throw new Error('A valid Heartbeat task UID is required.');
  }

  await saveDashboardSetting(VIDMOLY_HEARTBEAT_TASK_SETTING, taskUid);
  console.log(JSON.stringify({ ok: true, setting: VIDMOLY_HEARTBEAT_TASK_SETTING }));
}

main().catch((error) => {
  console.error(error.message || 'Unable to save the Heartbeat task UID.');
  process.exitCode = 1;
});
