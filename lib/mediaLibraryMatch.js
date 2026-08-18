function normalizeImageName(value) {
  return (value || '')
    .toString()
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function getImageName(item) {
  if (!item || typeof item !== 'object') return '';
  return item.name || item.filename || item.file_name || '';
}

function scoreImageMatch(query, item) {
  const queryNorm = normalizeImageName(query);
  const nameNorm = normalizeImageName(getImageName(item));
  if (!queryNorm || !nameNorm) return 0;

  let score = 0;
  if (queryNorm === nameNorm) score += 100;
  else if (nameNorm.includes(queryNorm)) score += 60;
  else if (queryNorm.includes(nameNorm)) score += 35;
  else return 0;

  const queryTokens = new Set(queryNorm.split(' ').filter(Boolean));
  score += nameNorm.split(' ').reduce((total, token) => total + (queryTokens.has(token) ? 8 : 0), 0);
  if (item.url || item.display_url) score += 2;
  return score;
}

function findMediaLibraryMatch(query, items) {
  const list = Array.isArray(items) ? items : [];
  const ranked = list
    .map((item) => ({ item, score: scoreImageMatch(query, item) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;

  const item = ranked[0].item;
  return {
    ...item,
    image_url: item.url || item.display_url || item.thumb || '',
  };
}

module.exports = {
  findMediaLibraryMatch,
  getImageName,
  normalizeImageName,
  scoreImageMatch,
};
