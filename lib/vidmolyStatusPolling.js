const VIDMOLY_STATUS_POLL_INTERVAL_MS = 60 * 1000;
const MAX_VIDMOLY_STATUS_POLLS = 15;

function canPollVidmolyStatus({ lastPolledAt, now = Date.now(), inFlight = false }) {
  if (inFlight) return false;
  if (!Number.isFinite(lastPolledAt)) return true;
  return now - lastPolledAt >= VIDMOLY_STATUS_POLL_INTERVAL_MS;
}

function shouldContinueVidmolyStatusPolling(item) {
  return Boolean(
    item &&
      item.status === 'downloading' &&
      item.fileCode &&
      (item.pollCount || 0) < MAX_VIDMOLY_STATUS_POLLS
  );
}

module.exports = {
  VIDMOLY_STATUS_POLL_INTERVAL_MS,
  MAX_VIDMOLY_STATUS_POLLS,
  canPollVidmolyStatus,
  shouldContinueVidmolyStatusPolling,
};
