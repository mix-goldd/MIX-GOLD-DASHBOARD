const { _private } = require('../lib/vidmoly');

describe('Vidmoly failover policy', () => {
  it('retries rate limits and transient provider failures', () => {
    expect(_private.isRetryableResponse(429, { status: 429 })).toBe(true);
    expect(_private.isRetryableResponse(503, { status: 503 })).toBe(true);
    expect(_private.isRetryableResponse(500, {})).toBe(true);
  });

  it('does not rotate keys to hide permanent authentication failures', () => {
    expect(_private.isRetryableResponse(401, { status: 401 })).toBe(false);
    expect(_private.isRetryableResponse(403, { status: 403 })).toBe(false);
    expect(_private.isRetryableResponse(400, { status: 400 })).toBe(false);
  });

  it('keeps failover bounded to protect the daily quota', () => {
    expect(_private.MAX_FAILOVER_ATTEMPTS).toBe(3);
  });
});
