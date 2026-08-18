'use strict';

function toSizeBytes(value) {
  if (value === null || value === undefined || value === '') return null;
  const directBytes = Number(value);
  if (Number.isFinite(directBytes) && directBytes >= 0) return directBytes;

  const match = String(value).trim().match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return null;

  const unitFactors = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  const bytes = Number(match[1].replace(/,/g, '')) * unitFactors[match[2].toUpperCase()];
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

function getVideoSizeBytes(file = {}, cached = {}) {
  const candidates = [
    file.size,
    file.size_bytes,
    file.file_size,
    file.filesize,
    cached.size_bytes,
    cached.size,
    cached.file_size,
    cached.filesize,
  ];

  for (const candidate of candidates) {
    const bytes = toSizeBytes(candidate);
    if (bytes !== null) return bytes;
  }
  return null;
}

function calculateTotalVideoSize(files = []) {
  let hasMeasuredFile = false;
  let total = 0;

  for (const file of files) {
    const bytes = toSizeBytes(file?.size);
    if (bytes === null) continue;
    hasMeasuredFile = true;
    total += bytes;
  }

  return hasMeasuredFile ? total : null;
}

module.exports = {
  toSizeBytes,
  getVideoSizeBytes,
  calculateTotalVideoSize,
};
