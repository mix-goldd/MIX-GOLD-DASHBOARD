const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  emptyWorkflow,
  getPostWorkflow,
  updatePostWorkflow,
} = require('../lib/postPublishingWorkflow');

const NOW = new Date('2026-08-21T10:00:00.000Z');

test('new posts require a publishing schedule by default', () => {
  assert.equal(getPostWorkflow(emptyWorkflow(), 'post-1', NOW).status, STATUS.NEEDS_SCHEDULE);
});

test('a scheduled post becomes ready for manual approval when its time arrives', () => {
  const workflow = updatePostWorkflow(emptyWorkflow(), {
    action: 'schedule', postId: 'post-1', scheduledAt: '2026-08-21T10:30:00.000Z', now: NOW,
  });
  assert.equal(getPostWorkflow(workflow, 'post-1', new Date('2026-08-21T10:29:59.000Z')).status, STATUS.SCHEDULED);
  assert.equal(getPostWorkflow(workflow, 'post-1', new Date('2026-08-21T10:30:00.000Z')).status, STATUS.READY_FOR_APPROVAL);
});

test('manual share confirmation requires approval and skip requires a reason', () => {
  assert.throws(
    () => updatePostWorkflow(emptyWorkflow(), { action: 'confirm_shared', postId: 'post-1', now: NOW }),
    /اعتمدها أولًا/
  );
  assert.throws(
    () => updatePostWorkflow(emptyWorkflow(), { action: 'skip', postId: 'post-1', now: NOW }),
    /سبب التخطي/
  );

  const approved = updatePostWorkflow(emptyWorkflow(), { action: 'approve', postId: 'post-1', now: NOW });
  const confirmed = updatePostWorkflow(approved, { action: 'confirm_shared', postId: 'post-1', now: NOW });
  assert.equal(getPostWorkflow(confirmed, 'post-1', NOW).status, STATUS.CONFIRMED_SHARED);
});

