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

function getItemTitle(item) {
  return item?.title || item?.name || item?.file_title || item?.file_name || 'بدون عنوان';
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getItemSizeBytes(item) {
  const direct = finiteNumber(item?.size || item?.size_bytes || item?.file_size || item?.filesize);
  if (!direct) return 0;
  const source = String(item?.size || '').toLowerCase();
  if (/\bgb\b/.test(source)) return Math.round(direct * 1024 * 1024 * 1024);
  if (/\bmb\b/.test(source)) return Math.round(direct * 1024 * 1024);
  if (/\bkb\b/.test(source)) return Math.round(direct * 1024);
  return Math.round(direct);
}

function getItemUploadedAt(item) {
  const raw = item?.uploaded || item?.uploaded_date || item?.created_at || '';
  const timestamp = raw ? Date.parse(raw) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getLibraryItemDetails(item) {
  return {
    title: getItemTitle(item),
    file_code: item?.file_code || item?.filecode || item?.code || item?.fileCode || '',
    duration: item?.length || item?.duration || '',
    size: getItemSizeBytes(item),
    views: finiteNumber(item?.views),
    uploaded: item?.uploaded || item?.uploaded_date || '',
    folder: item?.folder || '',
    thumbnail_url: item?.thumb || item?.single_img || item?.thumbnail_url || '',
    playback_url: buildPlaybackUrl(item || {}),
    download_url: buildDownloadUrl(item || {}),
  };
}

// A file whose title is just a quality label or bare number ("1080p",
// "720", "video_1") — the shape a remote-download host's own filename
// leaves behind when nobody typed a real title. Only these are ever
// proposed for a size-based rename; anything that already looks like a
// real title is left alone so this can never clobber a correct name.
function isGenericVideoTitle(title) {
  const value = String(title || '').trim();
  if (!value) return true;
  return /^(?:\d{2,4}p?|hd|sd|video|film|movie|download|untitled|بدون عنوان)[\s_.-]*\d*$/i.test(value);
}

// Matches a user-supplied {episode, sizeMb} list against the already-
// uploaded, still-generically-titled files in the library snapshot, purely
// by file size (±1%, minimum 1MB tolerance, to absorb rounding without
// letting two close-sized episodes collide). Deliberately conservative: any
// file already used, or any entry with zero or more than one candidate
// within tolerance, is left unresolved rather than guessed at — a wrong
// guess here would publish under the wrong episode number.
function matchTitlesBySize(rawFiles, entries, series) {
  const candidates = (Array.isArray(rawFiles) ? rawFiles : [])
    .map((raw) => getLibraryItemDetails(raw))
    .filter((item) => item.file_code && item.size > 0 && isGenericVideoTitle(item.title));

  const usedFileCodes = new Set();
  const proposals = [];
  const unresolved = [];

  entries.forEach((entry) => {
    const targetBytes = entry.sizeMb * 1024 * 1024;
    const tolerance = Math.max(targetBytes * 0.01, 1024 * 1024);
    const matches = candidates.filter((item) => !usedFileCodes.has(item.file_code) && Math.abs(item.size - targetBytes) <= tolerance);
    if (matches.length === 1) {
      const item = matches[0];
      usedFileCodes.add(item.file_code);
      proposals.push({
        file_code: item.file_code,
        oldTitle: item.title,
        newTitle: `${series} - الحلقة ${entry.episode}`,
        sizeMb: entry.sizeMb,
        episode: entry.episode,
      });
    } else {
      unresolved.push({ episode: entry.episode, sizeMb: entry.sizeMb, reason: matches.length === 0 ? 'no-match' : 'ambiguous' });
    }
  });

  return { proposals, unresolved };
}

function normalizeAdvancedFilters(input = {}) {
  const sort = ['relevance', 'newest', 'largest', 'most-viewed'].includes(input.sort) ? input.sort : 'relevance';
  return {
    query: String(input.query || '').trim().slice(0, 160),
    folder: String(input.folder || '').trim().slice(0, 100),
    sort,
    minViews: Math.max(0, Math.min(1000000000, Math.floor(finiteNumber(input.minViews)))),
    minSizeMb: Math.max(0, Math.min(1000000, finiteNumber(input.minSizeMb))),
  };
}

function findAdvancedLibraryMatches(snapshotPayload, inputFilters = {}, limit = 12) {
  const filters = normalizeAdvancedFilters(inputFilters);
  const queryNorm = normalizeText(filters.query);
  const folderNorm = normalizeText(filters.folder);
  const minSizeBytes = filters.minSizeMb * 1024 * 1024;

  const results = collectLibraryFiles(snapshotPayload)
    .map((item) => ({ item, details: getLibraryItemDetails(item), score: queryNorm ? scoreMatch(filters.query, item) : 1 }))
    .filter(({ details, score }) => score > 0
      && (!folderNorm || normalizeText(details.folder).includes(folderNorm))
      && details.views >= filters.minViews
      && details.size >= minSizeBytes)
    .sort((left, right) => {
      if (filters.sort === 'newest') return getItemUploadedAt(right.item) - getItemUploadedAt(left.item) || right.score - left.score;
      if (filters.sort === 'largest') return right.details.size - left.details.size || right.score - left.score;
      if (filters.sort === 'most-viewed') return right.details.views - left.details.views || right.score - left.score;
      return right.score - left.score || right.details.views - left.details.views;
    })
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 12)))
    .map(({ details }) => details);

  return { filters, results };
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
  findAdvancedLibraryMatches,
  findVidmolyLibraryMatch,
  getLibraryItemDetails,
  isGenericVideoTitle,
  matchTitlesBySize,
  normalizeAdvancedFilters,
  normalizeText,
  scoreMatch,
};
