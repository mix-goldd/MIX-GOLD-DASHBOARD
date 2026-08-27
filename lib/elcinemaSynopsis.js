const SOURCE_ORIGIN = 'https://elcinema.com';
const ALLOWED_HOSTS = new Set(['elcinema.com', 'www.elcinema.com']);
const MAX_TITLE_LENGTH = 120;
const MAX_EPISODE = 999;
const MAX_RESPONSE_BYTES = 750 * 1024;
const MAX_SYNOPSIS_LENGTH = 700;
const FETCH_TIMEOUT_MS = 8000;

class SynopsisLookupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SynopsisLookupError';
    this.code = code;
  }
}

function cleanText(value) {
  const namedEntities = {
    amp: '&', apos: "'", gt: '>', hellip: '…', lt: '<', mdash: '—', ndash: '–', nbsp: ' ', quot: '"',
  };
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, encoded) => {
      const base = encoded.toLowerCase().startsWith('x') ? 16 : 10;
      const codePoint = Number.parseInt(base === 16 ? encoded.slice(1) : encoded, base);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch (error) {
        return match;
      }
    })
    .replace(/&(amp|apos|gt|hellip|lt|mdash|ndash|nbsp|quot);/gi, (match, name) => namedEntities[name.toLowerCase()] || match)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparable(value) {
  return cleanText(value)
    .toLocaleLowerCase('ar')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064b-\u065f\u0670ـ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isAllowedSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

function assertAllowedSourceUrl(value) {
  if (!isAllowedSourceUrl(value)) {
    throw new SynopsisLookupError('SOURCE_INVALID_URL', 'تعذر التحقق من عنوان المصدر العام.');
  }
  return new URL(value).toString();
}

function validateSynopsisRequest(input = {}) {
  const rawTitle = typeof input.title === 'string' ? input.title.trim() : '';
  if (!rawTitle || rawTitle.length > MAX_TITLE_LENGTH) {
    throw new SynopsisLookupError('INVALID_INPUT', `اكتب اسم عمل بين حرف واحد و${MAX_TITLE_LENGTH} حرفًا.`);
  }
  const title = cleanText(rawTitle);
  if (!title) throw new SynopsisLookupError('INVALID_INPUT', 'اكتب اسم العمل للبحث عن ملخصه.');

  const rawEpisode = input.episode === undefined || input.episode === null ? '' : String(input.episode).trim();
  if (!rawEpisode) return { title, episode: null };
  if (!/^[1-9]\d{0,2}$/.test(rawEpisode)) {
    throw new SynopsisLookupError('INVALID_INPUT', `رقم الحلقة يجب أن يكون من 1 إلى ${MAX_EPISODE}.`);
  }
  const episode = Number(rawEpisode);
  if (episode > MAX_EPISODE) {
    throw new SynopsisLookupError('INVALID_INPUT', `رقم الحلقة يجب أن يكون من 1 إلى ${MAX_EPISODE}.`);
  }
  return { title, episode };
}

function buildSearchUrl(title) {
  return assertAllowedSourceUrl(`${SOURCE_ORIGIN}/search/?q=${encodeURIComponent(title)}`);
}

function buildWorkUrl(workId, suffix = '') {
  if (!/^\d+$/.test(String(workId || ''))) throw new SynopsisLookupError('SOURCE_INVALID_RESPONSE', 'استجابة المصدر لا تحتوي على عمل صالح.');
  return assertAllowedSourceUrl(`${SOURCE_ORIGIN}/work/${workId}/${suffix}`);
}

function readAttribute(tag, attribute) {
  const quoted = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  if (quoted) return quoted[2];
  const bare = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*([^\\s>]+)`, 'i'));
  return bare ? bare[1] : '';
}

function workResultFromHref(rawHref) {
  if (!rawHref) return null;
  let url;
  try {
    url = new URL(rawHref, SOURCE_ORIGIN);
  } catch (error) {
    return null;
  }
  if (!isAllowedSourceUrl(url.toString())) return null;
  const match = url.pathname.match(/^\/work\/(\d+)\/?$/);
  return match ? match[1] : null;
}

function extractWorkSearchResult(html, requestedTitle) {
  const candidates = [];
  for (const match of String(html || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const workId = workResultFromHref(readAttribute(match[1], 'href'));
    if (!workId) continue;
    const title = cleanText(match[2]);
    if (title) candidates.push({ workId, title });
  }
  if (!candidates.length) return null;

  const expected = normalizeComparable(requestedTitle);
  return candidates.find((candidate) => {
    const candidateTitle = normalizeComparable(candidate.title);
    return candidateTitle.includes(expected) || expected.includes(candidateTitle);
  }) || candidates[0];
}

function extractPageTitle(html, fallback) {
  const heading = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = heading ? cleanText(heading[1]) : '';
  return h1 || cleanText(fallback);
}

function extractFirstParagraph(html) {
  const match = String(html || '').match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return match ? cleanText(match[1]) : '';
}

function extractWorkSynopsis(html) {
  const labeled = String(html || '').match(/(?:ملخص\s+(?:القصة|القصه)|قصة\s+العمل)[\s\S]{0,1800}?<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return labeled ? cleanText(labeled[1]) : '';
}

function extractEpisodeSynopsis(html, episode, workId) {
  const source = String(html || '');
  const episodeLabel = `(?:الحلقة|حلقة)\\s*(?:رقم\\s*)?(?:#|&#35;|\\-)?\\s*${Number(episode)}\\b`;
  // صفحات الحلقات تبدأ بفهرس روابط #episode_N ثم كتل تفاصيل تحمل id="episode_N".
  // نفضّل الكتلة المعنونة بالمعرف كي لا يلتقط البحث رابط الفهرس الأول.
  const detailedMarker = new RegExp(`\\bid\\s*=\\s*(["'])episode_[^"']*\\1[\\s\\S]{0,800}?${episodeLabel}`, 'i');
  const fallbackMarker = new RegExp(episodeLabel, 'i');
  const found = detailedMarker.exec(source) || fallbackMarker.exec(source);
  if (!found) return null;

  const afterMarker = source.slice(found.index + found[0].length);
  const nextMarker = afterMarker.search(/(?:الحلقة|حلقة)\s*(?:رقم\s*)?(?:#|&#35;|\-)?\s*\d+\b/i);
  const block = afterMarker.slice(0, nextMarker >= 0 ? nextMarker : 9000);
  const synopsis = extractFirstParagraph(block);
  if (!synopsis) return null;

  const detailPattern = new RegExp(`href\\s*=\\s*(["'])(/work/${workId}/episodes/\\d+/?(?:\\?[^"']*)?)\\1`, 'i');
  const detailMatch = block.match(detailPattern);
  return {
    synopsis,
    sourceUrl: detailMatch ? assertAllowedSourceUrl(new URL(detailMatch[2], SOURCE_ORIGIN).toString()) : buildWorkUrl(workId, 'episodes'),
  };
}

function excerptSynopsis(value) {
  const text = cleanText(value);
  if (text.length <= MAX_SYNOPSIS_LENGTH) return text;
  return `${text.slice(0, MAX_SYNOPSIS_LENGTH - 1).trimEnd()}…`;
}

function formatSourceSynopsis(value) {
  const sourceText = cleanText(value);
  const synopsis = excerptSynopsis(sourceText);
  return { synopsis, isTruncated: synopsis.length < sourceText.length };
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new SynopsisLookupError('SOURCE_RESPONSE_TOO_LARGE', 'استجابة المصدر أكبر من الحد المسموح.');
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new SynopsisLookupError('SOURCE_RESPONSE_TOO_LARGE', 'استجابة المصدر أكبر من الحد المسموح.');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new SynopsisLookupError('SOURCE_RESPONSE_TOO_LARGE', 'استجابة المصدر أكبر من الحد المسموح.');
  }
  return text;
}

async function fetchAllowedHtml(url, fetchImpl = fetch) {
  const requestedUrl = assertAllowedSourceUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(requestedUrl, {
      method: 'GET',
      headers: { Accept: 'text/html', 'User-Agent': 'MIX-GOLD-Dashboard/1.0 (+https://mix-gold-dashboard.vercel.app)' },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });
    const finalUrl = assertAllowedSourceUrl(response?.url || requestedUrl);
    const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
    if (!response || response.ok === false || (Number.isFinite(response.status) && (response.status < 200 || response.status >= 300))) {
      throw new SynopsisLookupError('SOURCE_UNAVAILABLE', 'المصدر العام غير متاح حاليًا. حاول لاحقًا.');
    }
    if (!contentType.includes('text/html')) {
      throw new SynopsisLookupError('SOURCE_INVALID_RESPONSE', 'استجابة المصدر ليست صفحة نصية صالحة للبحث.');
    }
    return { html: await readBoundedResponse(response), url: finalUrl };
  } catch (error) {
    if (error instanceof SynopsisLookupError) throw error;
    if (error?.name === 'AbortError') {
      throw new SynopsisLookupError('SOURCE_TIMEOUT', 'استغرق المصدر وقتًا أطول من المسموح. حاول لاحقًا.');
    }
    throw new SynopsisLookupError('SOURCE_UNAVAILABLE', 'تعذر الوصول إلى المصدر العام الآن. حاول لاحقًا.');
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupElcinemaSynopsis(input, { fetchImpl = fetch } = {}) {
  const { title, episode } = validateSynopsisRequest(input);
  const search = await fetchAllowedHtml(buildSearchUrl(title), fetchImpl);
  const work = extractWorkSearchResult(search.html, title);
  if (!work) throw new SynopsisLookupError('NOT_FOUND', `لم نعثر على عمل مطابق لاسم «${title}» في المصدر العام.`);

  const workUrl = buildWorkUrl(work.workId);
  const detail = await fetchAllowedHtml(episode ? buildWorkUrl(work.workId, 'episodes') : workUrl, fetchImpl);
  const resolvedTitle = extractPageTitle(detail.html, work.title || title);
  if (episode) {
    const episodeResult = extractEpisodeSynopsis(detail.html, episode, work.workId);
    if (!episodeResult) {
      throw new SynopsisLookupError('EPISODE_NOT_FOUND', `لم يتوفر ملخص واضح للحلقة ${episode} من «${resolvedTitle || title}» في المصدر.`);
    }
    const sourceSynopsis = formatSourceSynopsis(episodeResult.synopsis);
    return {
      title: resolvedTitle || title,
      episode,
      ...sourceSynopsis,
      sourceName: 'السينما.كوم',
      sourceUrl: episodeResult.sourceUrl,
      fetchedAt: new Date().toISOString(),
    };
  }

  const synopsis = extractWorkSynopsis(detail.html);
  if (!synopsis) throw new SynopsisLookupError('SYNOPSIS_NOT_FOUND', `وجدنا «${resolvedTitle || title}» لكن لم يتوفر له ملخص واضح في المصدر.`);
  const sourceSynopsis = formatSourceSynopsis(synopsis);
  return {
    title: resolvedTitle || title,
    episode: null,
    ...sourceSynopsis,
    sourceName: 'السينما.كوم',
    sourceUrl: workUrl,
    fetchedAt: new Date().toISOString(),
  };
}

function errorResponse(error) {
  if (error instanceof SynopsisLookupError) {
    const status = error.code === 'INVALID_INPUT' ? 400 : (error.code === 'NOT_FOUND' || error.code === 'EPISODE_NOT_FOUND' || error.code === 'SYNOPSIS_NOT_FOUND' ? 404 : 503);
    return { status, error: error.message };
  }
  return { status: 503, error: 'تعذر البحث في المصدر العام الآن. حاول لاحقًا.' };
}

module.exports = {
  ALLOWED_HOSTS,
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_SYNOPSIS_LENGTH,
  SynopsisLookupError,
  buildSearchUrl,
  cleanText,
  errorResponse,
  excerptSynopsis,
  extractEpisodeSynopsis,
  extractWorkSearchResult,
  extractWorkSynopsis,
  fetchAllowedHtml,
  isAllowedSourceUrl,
  lookupElcinemaSynopsis,
  validateSynopsisRequest,
};
