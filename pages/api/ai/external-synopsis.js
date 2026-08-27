const { requireAuth } = require('../../../lib/api-auth');
const { errorResponse, lookupElcinemaSynopsis, validateSynopsisRequest } = require('../../../lib/elcinemaSynopsis');

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 80;
const synopsisCache = new Map();

function cacheKey({ title, episode }) {
  return `${title.toLocaleLowerCase('ar')}::${episode || 'work'}`;
}

function readCache(key) {
  const cached = synopsisCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.savedAt > CACHE_TTL_MS) {
    synopsisCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeCache(key, value) {
  synopsisCache.set(key, { savedAt: Date.now(), value });
  while (synopsisCache.size > CACHE_LIMIT) {
    synopsisCache.delete(synopsisCache.keys().next().value);
  }
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const request = validateSynopsisRequest(req.body || {});
    const key = cacheKey(request);
    const cached = readCache(key);
    if (cached) return res.status(200).json({ ...cached, cached: true });

    const synopsis = await lookupElcinemaSynopsis(request);
    writeCache(key, synopsis);
    return res.status(200).json({ ...synopsis, cached: false });
  } catch (error) {
    const response = errorResponse(error);
    return res.status(response.status).json({ error: response.error });
  }
}
