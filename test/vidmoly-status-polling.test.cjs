const {
  VIDMOLY_STATUS_POLL_INTERVAL_MS,
  MAX_VIDMOLY_STATUS_POLLS,
  canPollVidmolyStatus,
  shouldContinueVidmolyStatusPolling,
} = require('../lib/vidmolyStatusPolling');

describe('Vidmoly upload status polling', () => {
  test('allows only one status check per video every full minute', () => {
    const now = 1_000_000;
    expect(canPollVidmolyStatus({ lastPolledAt: null, now })).toBe(true);
    expect(canPollVidmolyStatus({ lastPolledAt: now, now: now + VIDMOLY_STATUS_POLL_INTERVAL_MS - 1 })).toBe(false);
    expect(canPollVidmolyStatus({ lastPolledAt: now, now: now + VIDMOLY_STATUS_POLL_INTERVAL_MS })).toBe(true);
  });

  test('does not start a second request while the first status check is still running', () => {
    expect(canPollVidmolyStatus({ lastPolledAt: 0, now: VIDMOLY_STATUS_POLL_INTERVAL_MS * 2, inFlight: true })).toBe(false);
  });

  test('stops polling completed items and items that reached the maximum attempts', () => {
    expect(shouldContinueVidmolyStatusPolling({ status: 'done', fileCode: 'ready', pollCount: 0 })).toBe(false);
    expect(
      shouldContinueVidmolyStatusPolling({
        status: 'downloading',
        fileCode: 'slow-file',
        pollCount: MAX_VIDMOLY_STATUS_POLLS,
      })
    ).toBe(false);
    expect(shouldContinueVidmolyStatusPolling({ status: 'downloading', fileCode: 'pending', pollCount: 1 })).toBe(true);
  });
});
