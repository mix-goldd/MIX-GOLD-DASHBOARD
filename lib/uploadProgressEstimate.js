const DEFAULT_REMOTE_SPEED_BYTES_PER_SEC = 400 * 1024;
const MIN_PLAUSIBLE_SPEED_BYTES_PER_SEC = 16 * 1024;
const MAX_PLAUSIBLE_SPEED_BYTES_PER_SEC = 50 * 1024 * 1024;
const SAMPLE_WINDOW_MS = 8_000;
const REMOTE_PROGRESS_CAP = 98;

function isPlausibleSpeed(value) {
  return Number.isFinite(value) && value >= MIN_PLAUSIBLE_SPEED_BYTES_PER_SEC && value <= MAX_PLAUSIBLE_SPEED_BYTES_PER_SEC;
}

function getSafeRemoteSpeed(value) {
  return isPlausibleSpeed(value) ? value : DEFAULT_REMOTE_SPEED_BYTES_PER_SEC;
}

function keepRecentProgressSamples(samples, now = Date.now()) {
  if (!Array.isArray(samples)) return [];
  return samples
    .filter((sample) => Number.isFinite(sample?.at) && Number.isFinite(sample?.loaded) && sample.loaded >= 0)
    .filter((sample) => sample.at <= now && sample.at >= now - SAMPLE_WINDOW_MS)
    .sort((a, b) => a.at - b.at);
}

function calculateMeasuredUploadProgress({ samples, total, now = Date.now() }) {
  const recent = keepRecentProgressSamples(samples, now);
  const latest = recent[recent.length - 1];
  const first = recent[0];
  const safeTotal = Number(total) > 0 ? Number(total) : 0;
  const loaded = latest ? Math.min(Number(latest.loaded), safeTotal || Number(latest.loaded)) : 0;
  const pct = safeTotal ? Math.min(100, Math.round((loaded / safeTotal) * 100)) : 0;

  if (!first || !latest || latest.at - first.at < 750 || latest.loaded <= first.loaded) {
    return { pct, loaded, rateBytesPerSec: 0, etaSec: null, samples: recent };
  }

  const rateBytesPerSec = (latest.loaded - first.loaded) / ((latest.at - first.at) / 1000);
  if (!isPlausibleSpeed(rateBytesPerSec)) {
    return { pct, loaded, rateBytesPerSec: 0, etaSec: null, samples: recent };
  }

  const etaSec = safeTotal > loaded ? (safeTotal - loaded) / rateBytesPerSec : 0;
  return { pct, loaded, rateBytesPerSec, etaSec, samples: recent };
}

function calculateRemoteTimeEstimate({ sourceSize, startedAt, learnedSpeed, now = Date.now() }) {
  const total = Number(sourceSize);
  const start = Number(startedAt);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(start) || start <= 0) return null;

  const rateBytesPerSec = getSafeRemoteSpeed(learnedSpeed);
  const elapsedSec = Math.max(0, (now - start) / 1000);
  const estimatedBytes = Math.min(total, elapsedSec * rateBytesPerSec);
  const pct = Math.min(REMOTE_PROGRESS_CAP, (estimatedBytes / total) * 100);
  const etaSec = Math.max(0, (total - estimatedBytes) / rateBytesPerSec);
  return { pct, etaSec, rateBytesPerSec };
}

function blendRemoteSpeed({ previousSpeed, observedSpeed }) {
  if (!isPlausibleSpeed(observedSpeed)) return getSafeRemoteSpeed(previousSpeed);
  const previous = getSafeRemoteSpeed(previousSpeed);
  // Keep the initial estimate conservative while letting completed uploads
  // make later estimates more representative of this user's usual sources.
  return Math.round(previous * 0.6 + observedSpeed * 0.4);
}

module.exports = {
  DEFAULT_REMOTE_SPEED_BYTES_PER_SEC,
  calculateMeasuredUploadProgress,
  calculateRemoteTimeEstimate,
  blendRemoteSpeed,
  getSafeRemoteSpeed,
  keepRecentProgressSamples,
};
