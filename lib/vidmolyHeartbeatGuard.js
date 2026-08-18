const VIDMOLY_HEARTBEAT_TASK_SETTING = 'vidmoly_usage_heartbeat_task_uid';

function isRegisteredHeartbeatTask(expectedTaskUid, receivedTaskUid) {
  return Boolean(
    expectedTaskUid
      && receivedTaskUid
      && String(expectedTaskUid) === String(receivedTaskUid)
  );
}

module.exports = {
  VIDMOLY_HEARTBEAT_TASK_SETTING,
  isRegisteredHeartbeatTask,
};
