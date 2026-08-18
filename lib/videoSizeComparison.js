'use strict';

const FACTORS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

function parseVideoSizeBytes(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const match = String(value).trim().match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return null;
  const bytes = Number(match[1].replace(/,/g, '')) * FACTORS[match[2].toUpperCase()];
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

function calculateVideoSizeSummary(files = []) {
  let totalBytes = 0;
  let measuredCount = 0;
  for (const file of files) {
    const size = parseVideoSizeBytes(file?.size);
    if (size === null) continue;
    totalBytes += size;
    measuredCount += 1;
  }
  return {
    totalBytes: measuredCount > 0 ? totalBytes : null,
    measuredCount,
    unknownCount: Math.max(0, files.length - measuredCount),
  };
}

function compareVideoSizeToStorage(files, reportedStorageBytes) {
  const summary = calculateVideoSizeSummary(files);
  const reported = parseVideoSizeBytes(reportedStorageBytes);
  return {
    ...summary,
    reportedStorageBytes: reported,
    differenceBytes: summary.totalBytes !== null && reported !== null ? summary.totalBytes - reported : null,
  };
}

module.exports = { parseVideoSizeBytes, calculateVideoSizeSummary, compareVideoSizeToStorage };
