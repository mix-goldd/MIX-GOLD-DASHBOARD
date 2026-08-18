async function cacheKnownUploadSize(cacheFileSize, fileCode, sizeBytes) {
  if (sizeBytes === null || sizeBytes === undefined || sizeBytes === '') return false;
  const normalizedSize = Number(sizeBytes);
  if (!fileCode || !Number.isFinite(normalizedSize) || normalizedSize < 0) return false;

  await cacheFileSize(fileCode, normalizedSize);
  return true;
}

module.exports = { cacheKnownUploadSize };
