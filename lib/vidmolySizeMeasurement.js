const { getVideoSizeBytes } = require('./vidmolyStorage');

const SIZE_KEYS = new Set(['size', 'size_bytes', 'file_size', 'filesize', 'content_length', 'contentLength']);

function findSizeBytes(value, depth = 0, seen = new Set()) {
  if (!value || depth > 4 || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);

  const direct = getVideoSizeBytes(value, value);
  if (direct !== null) return direct;

  for (const [key, child] of Object.entries(value)) {
    if (SIZE_KEYS.has(key) && child !== value) {
      const nested = getVideoSizeBytes({ size: child });
      if (nested !== null) return nested;
    }
    if (child && typeof child === 'object') {
      const nested = findSizeBytes(child, depth + 1, seen);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function getMeasuredSizeFromResponse(payload) {
  return findSizeBytes(payload);
}

function mergeMeasuredSize(files, fileCode, sizeBytes) {
  if (!Array.isArray(files) || !fileCode || !Number.isFinite(Number(sizeBytes))) return files;
  return files.map((file) => file.file_code === fileCode ? { ...file, size: Number(sizeBytes) } : file);
}

module.exports = { findSizeBytes, getMeasuredSizeFromResponse, mergeMeasuredSize };
