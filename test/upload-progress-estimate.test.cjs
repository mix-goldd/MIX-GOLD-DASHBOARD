const { test: nodeTest } = require('node:test');
const test = globalThis.test || nodeTest;
const assert = require('node:assert/strict');
const {
  DEFAULT_REMOTE_SPEED_BYTES_PER_SEC,
  calculateMeasuredUploadProgress,
  calculateRemoteTimeEstimate,
  blendRemoteSpeed,
  keepRecentProgressSamples,
} = require('../lib/uploadProgressEstimate');

test('calculates local upload speed and remaining time from a recent real progress window', () => {
  const result = calculateMeasuredUploadProgress({
    total: 10_000_000,
    now: 8_000,
    samples: [
      { at: 0, loaded: 0 },
      { at: 4_000, loaded: 2_000_000 },
      { at: 8_000, loaded: 4_000_000 },
    ],
  });

  assert.equal(result.pct, 40);
  assert.equal(result.rateBytesPerSec, 500_000);
  assert.equal(result.etaSec, 12);
});

test('withholds a local ETA until there are enough real progress samples', () => {
  const result = calculateMeasuredUploadProgress({
    total: 10_000_000,
    now: 500,
    samples: [{ at: 500, loaded: 150_000 }],
  });

  assert.equal(result.rateBytesPerSec, 0);
  assert.equal(result.etaSec, null);
});

test('discards stale progress samples so a past slow start does not distort the ETA', () => {
  const samples = keepRecentProgressSamples(
    [
      { at: 0, loaded: 0 },
      { at: 9_000, loaded: 4_000_000 },
      { at: 10_000, loaded: 5_000_000 },
    ],
    10_000
  );

  assert.deepEqual(samples, [
    { at: 9_000, loaded: 4_000_000 },
    { at: 10_000, loaded: 5_000_000 },
  ]);
});

test('starts remote transfers with a conservative estimate and never treats it as complete', () => {
  const result = calculateRemoteTimeEstimate({
    sourceSize: 400 * 1024 * 1024,
    startedAt: 0,
    now: 60_000,
    learnedSpeed: DEFAULT_REMOTE_SPEED_BYTES_PER_SEC,
  });

  assert.equal(result, null);

  const active = calculateRemoteTimeEstimate({
    sourceSize: 400 * 1024 * 1024,
    startedAt: 1,
    now: 60_001,
    learnedSpeed: DEFAULT_REMOTE_SPEED_BYTES_PER_SEC,
  });
  assert.equal(active.rateBytesPerSec, DEFAULT_REMOTE_SPEED_BYTES_PER_SEC);
  assert.ok(active.pct > 0 && active.pct < 98);
  assert.ok(active.etaSec > 0);
});

test('blends a completed remote transfer into later estimates without accepting impossible speeds', () => {
  const learned = blendRemoteSpeed({
    previousSpeed: DEFAULT_REMOTE_SPEED_BYTES_PER_SEC,
    observedSpeed: 800 * 1024,
  });
  assert.equal(learned, 573_440);
  assert.equal(
    blendRemoteSpeed({ previousSpeed: learned, observedSpeed: 1 }),
    learned
  );
});
