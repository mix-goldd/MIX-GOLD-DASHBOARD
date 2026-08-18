const {
  VIDMOLY_HEARTBEAT_TASK_SETTING,
  isRegisteredHeartbeatTask,
} = require('../lib/vidmolyHeartbeatGuard');

describe('Vidmoly Heartbeat guard', () => {
  it('uses a stable dashboard setting key for the permitted Heartbeat task', () => {
    expect(VIDMOLY_HEARTBEAT_TASK_SETTING).toBe('vidmoly_usage_heartbeat_task_uid');
  });

  it('accepts only the exact registered task UID', () => {
    expect(isRegisteredHeartbeatTask('task_123', 'task_123')).toBe(true);
    expect(isRegisteredHeartbeatTask('task_123', 'task_456')).toBe(false);
  });

  it('rejects empty or missing task UIDs', () => {
    expect(isRegisteredHeartbeatTask('', 'task_123')).toBe(false);
    expect(isRegisteredHeartbeatTask('task_123', '')).toBe(false);
    expect(isRegisteredHeartbeatTask(null, 'task_123')).toBe(false);
  });
});
