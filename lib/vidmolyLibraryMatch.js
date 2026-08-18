function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function collectLibraryFiles(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.files)) return value.files;
  if (Array.isArray(value.result?.files)) return value.result.files;
  return [];
}

function extractCodeFromUrl(value) {
  if (!value) return '';
  const match = String(value).match(/(?:\/e\/|\/d\/|embed-|file_code=|filecode=|code=)([a-zA-Z0-9]+)(?:\.html)?/i);
  return match ? match[1] : '';
}

function buildPlaybackUrl(item) {
  const direct = item.playback_url || item.play_url || item.embed_url || item.video_url || '';
  const fileCode =
    item.file_code ||
    item.filecode ||
    item.code ||
    item.fileCode ||
    extractCodeFromUrl(direct) ||
    extractCodeFromUrl(item.download_url) ||
    extractCodeFromUrl(item.url);

  // The legacy .to domain is no longer a reliable player endpoint. The
  // provider's active embed host is .biz; this format was verified against
  // an uploaded file and keeps the file-code-only lookup fully local.
  if (fileCode) return `https://vidmoly.biz/embed-${fileCode}.html`;
  return direct || item.url || '';
}

function buildDownloadUrl(item) {
  const direct = item.download_url || item.downloadUrl || '';
  const fileCode =
    item.file_code ||
    item.filecode ||
    item.code ||
    item.fileCode ||
    extractCodeFromUrl(item.playback_url) ||
    extractCodeFromUrl(item.embed_url) ||
    extractCodeFromUrl(direct) ||
    extractCodeFromUrl(item.url);

  if (fileCode) return `https://vidmoly.me/dl/${fileCode}`;
  return direct;
}

function scoreMatch(query, item) {
  const queryNorm = normalizeText(query);
  const titleNorm = normalizeText(item.title || item.name || item.file_title || item.file_name || '');
  if (!queryNorm || !titleNorm) return 0;

  let score = 0;
  if (titleNorm === queryNorm) score += 100;
  if (titleNorm.includes(queryNorm)) score += 60;
  if (queryNorm.includes(titleNorm)) score += 35;

  const genericTokens = new Set(['episode', 'ep', 'الحلقة', 'حلقة', 'الموسم', 'season']);
  const queryTokens = new Set(queryNorm.split(' ').filter(Boolean));
  const titleTokens = titleNorm.split(' ').filter(Boolean);
  const distinctiveQueryTokens = [...queryTokens].filter((token) => !genericTokens.has(token) && !/^\d+$/.test(token));
  const hasDistinctiveTokenMatch = distinctiveQueryTokens.length === 0 || distinctiveQueryTokens.some((token) => titleTokens.includes(token));
  if (titleNorm !== queryNorm && !titleNorm.includes(queryNorm) && !queryNorm.includes(titleNorm) && !hasDistinctiveTokenMatch) {
    return 0;
  }
  score += titleTokens.reduce((total, token) => total + (queryTokens.has(token) ? 8 : 0), 0);
  if (item.length || item.duration) score += 2;
  if (item.file_code || item.filecode || item.code || item.fileCode) score += 2;
  return score;
}

function findVidmolyLibraryMatch(query, snapshotPayload) {
  const files = collectLibraryFiles(snapshotPayload);
  const ranked = files
    .map((item) => ({ item, score: scoreMatch(query, item) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;

  const item = ranked[0].item;
  return {
    title: item.title || item.name || String(query || '').trim(),
    file_code: item.file_code || item.filecode || item.code || item.fileCode || '',
    playback_url: buildPlaybackUrl(item),
    download_url: buildDownloadUrl(item),
    thumbnail_url: item.thumb || item.single_img || item.thumbnail_url || '',
    duration: item.length || item.duration || '',
  };
}

module.exports = {
  buildDownloadUrl,
  buildPlaybackUrl,
  collectLibraryFiles,
  findVidmolyLibraryMatch,
  normalizeText,
  scoreMatch,
};
