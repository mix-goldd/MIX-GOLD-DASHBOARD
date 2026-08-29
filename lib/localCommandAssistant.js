const { normalizeText } = require('./vidmolyLibraryMatch');
const { matchTrainedCommand } = require('./localCommandTraining');

function stripQuotes(value) {
  return String(value || '').trim().replace(/^["'«]+|["'»]+$/g, '').trim();
}

// Parses "501=334.66, 502=310.2 ميجا, 503=1.1 جيجا" into
// [{episode, sizeMb}, ...], normalizing GB entries to MB so every entry is
// comparable on the same scale. Malformed segments are silently dropped —
// the caller just gets fewer entries to match, not an error.
function parseSizeList(text) {
  return String(text || '')
    .split(/[,،؛;]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(/^(\d{1,4})\s*[:=]\s*([\d.]+)\s*(جيجا\w*|GB|جي\s?بي|ميجا\w*|MB|مب)?$/i);
      if (!match) return null;
      const episode = Number(match[1]);
      let sizeMb = Number(match[2]);
      const unit = (match[3] || 'MB').toUpperCase();
      if (unit.startsWith('ج') || unit === 'GB') sizeMb *= 1024;
      return Number.isFinite(sizeMb) && sizeMb > 0 ? { episode, sizeMb } : null;
    })
    .filter(Boolean);
}

function createLocalDraft(match) {
  if (!match) return null;
  return {
    type: 'video',
    file_code: match.file_code || '',
    title: match.title || '',
    image: match.thumbnail_url || '',
    url: match.playback_url || '',
    download_url: match.download_url || '',
    duration: match.duration || '',
  };
}

function parseEpisodeNumber(value) {
  const numeric = String(value || '').match(/^[1-9]\d{0,2}$/);
  if (numeric) return Number(numeric[0]);
  const words = {
    'الأول': 1, 'الأولى': 1, 'الاول': 1, 'الاولي': 1, 'الاولى': 1,
    'الثاني': 2, 'الثانيه': 2, 'الثانية': 2,
    'الثالث': 3, 'الثالثه': 3, 'الثالثة': 3,
  };
  return words[normalizeText(value).replace(/\s+/g, '')] || null;
}

function parseExternalSynopsisCommand(command) {
  const withoutSourceName = String(command || '')
    .replace(/\s+(?:من\s+)?(?:موقع\s+)?(?:السينما|سينما)(?:\s*\.?\s*كوم)?\s*$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const naturalEpisodeRequest = withoutSourceName.match(/^(?:(?:أنا|انا|كنت)\s+)?(?:عاوز|عايز|أريد|اريد|محتاج|هات|جيب|جلب)\s+(?:ملخص(?:\s+(?:القصة|القصه))?|نص\s+(?:الملخص|ملخص\s+القصة))\s+(?:الحلقة|حلقة)\s*#?\s*(\S+)\s+من\s+(?:مسلسل\s+)?(.+)$/i);
  if (naturalEpisodeRequest) {
    const title = stripQuotes(naturalEpisodeRequest[2]);
    const episode = parseEpisodeNumber(naturalEpisodeRequest[1]);
    return title && episode ? { type: 'external-synopsis', title, episode } : null;
  }
  const episodeToken = '(?:[1-9]\\d{0,2}|الأولى|الاولى|الأول|الاول|الثانية|الثانيه|الثاني|الثالثة|الثالثه|الثالث)';
  const requestPrefix = '(?:(?:(?:أنا|انا|كنت)\\s+)?(?:عاوز|عايز|أريد|اريد|محتاج|هات|جيب|جلب)\\s+)?';
  const summaryPrefix = '(?:(?:ملخص(?:\\s+(?:القصة|القصه))?|نص\\s+(?:الملخص|ملخص\\s+القصة))\\s+)?';
  const episodeFirst = withoutSourceName.match(new RegExp(`^${requestPrefix}${summaryPrefix}(?:الحلقة|حلقة)\\s*#?\\s*(${episodeToken})\\s+(?:من\\s+)?(?:مسلسل\\s+)?(.+)$`, 'i'));
  if (episodeFirst) {
    const title = stripQuotes(episodeFirst[2]);
    const episode = parseEpisodeNumber(episodeFirst[1]);
    return title && episode ? { type: 'external-synopsis', title, episode } : null;
  }

  const episodeMatch = withoutSourceName.match(new RegExp(`\\s+(?:الحلقة|حلقة)\\s*#?\\s*(${episodeToken})\\s*$`, 'i'));
  const episode = episodeMatch ? parseEpisodeNumber(episodeMatch[1]) : null;
  const withoutEpisode = episodeMatch ? withoutSourceName.slice(0, episodeMatch.index).trim() : withoutSourceName;
  const summary = withoutEpisode.match(/^(?:ملخص(?:\s+(?:قصة|قصه))?|(?:قصة|قصه)(?:\s+(?:العمل|المسلسل))?)\s+(?:(?:مسلسل|فيلم)\s+)?(.+)$/i);
  if (!summary) return null;
  const title = stripQuotes(summary[1]);
  return title ? { type: 'external-synopsis', title, episode } : null;
}

function parseLocalCommand(value, training = null) {
  const command = String(value || '').trim();
  const normalized = normalizeText(command);
  if (!normalized) return { type: 'help' };

  // User-confirmed phrases have priority over the standard parser. The ready
  // pack is consulted after the original command grammar so established
  // commands retain their existing response shape and labels.
  const trained = matchTrainedCommand(command, training, { includeBuiltIn: false });
  if (trained) return { ...trained, learned: true };

  const externalSynopsis = parseExternalSynopsisCommand(command);
  if (externalSynopsis) return externalSynopsis;

  // "صحح/غيّر عناوين <سلسلة> حسب الحجم: <رقم>=<حجم>[MB|GB], ..." — matches
  // already-uploaded, still-generically-titled files (e.g. "1080p") against
  // a size list the user compiled themselves (from the source site), purely
  // by comparing file size. Zero Vidmoly calls to propose — see
  // match-titles-by-size handling in pages/api/ai/chat.js for why renaming
  // is held behind a second confirm step (each real rename costs 1 quota
  // request, unlike matching which only reads the cached snapshot).
  const sizeMatch = command.match(/^(?:صحح|اصلح|غيّر|غير)\s+(?:عناوين|العناوين)\s+(.+?)\s+(?:حسب|بحسب|على أساس|علي أساس)\s+الحجم\s*:\s*(.+)$/i);
  if (sizeMatch) {
    const series = stripQuotes(sizeMatch[1]).trim();
    const entries = parseSizeList(sizeMatch[2]);
    return series && entries.length ? { type: 'match-titles-by-size', series, entries } : { type: 'help' };
  }

  // "حمل وانشر حلقات <سلسلة> من <رقم>: <روابط مفصولة بمسافة>" — the batch
  // form: numbers episodes sequentially starting from the given number, in
  // the exact order the links were pasted, so nothing needs typing a title
  // per link. Checked before the single-link form since it also starts with
  // حمل/حمّل/نزل/نزّل + انشر but is distinguished by the "حلقات" keyword.
  const batchUploadPublish = command.match(/^(?:حمل|حمّل|نزل|نزّل)\s+(?:و\s*)?(?:ثم\s+)?انشر(?:ها)?\s+حلقات\s+(.+?)\s+(?:بداية\s+)?من\s+(?:الحلقة\s+)?(\d{1,4})\s*[:٫]?\s+(https?:\/\/.+)$/i);
  if (batchUploadPublish) {
    const series = stripQuotes(batchUploadPublish[1]).trim();
    const startEpisode = Number(batchUploadPublish[2]);
    const urls = batchUploadPublish[3]
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => /^https?:\/\//i.test(part));
    if (series && startEpisode > 0 && urls.length > 0) {
      return { type: 'batch-upload-and-publish', series, startEpisode, urls };
    }
    return { type: 'help' };
  }

  // "حمل وانشر <رابط> باسم <عنوان>" — a single command spanning upload,
  // completion polling, and a live publish once ready. Checked before every
  // other verb since its own leading verb (حمل/حمّل/نزل/نزّل) never overlaps
  // with جهز/حضر/انشئ/انشر.
  const uploadPublish = command.match(/^(?:حمل|حمّل|نزل|نزّل)\s+(?:و\s*)?(?:ثم\s+)?انشر(?:ها)?\s+(\S+)\s+(?:باسم|بعنوان)\s+(.+)$/i);
  if (uploadPublish) {
    const url = uploadPublish[1].trim();
    const title = stripQuotes(uploadPublish[2]).trim();
    return title ? { type: 'upload-and-publish', url, title } : { type: 'help' };
  }

  const details = command.match(/^(?:معلومات|تفاصيل)(?:\s+(?:عن|الفيديو|فيديو))?\s+(.+)$/i);
  if (details) {
    const query = stripQuotes(details[1]);
    return query ? { type: 'details', query } : { type: 'help' };
  }

  if (/^(?:اعرض|عرض).*(?:احدث|أحدث).*(?:فيديوهات|الفيديوهات|ملفات|الملفات)/.test(normalized)) return { type: 'advanced-search', filters: { sort: 'newest' } };
  if (/^(?:اعرض|عرض).*(?:اكبر|أكبر).*(?:فيديوهات|الفيديوهات|ملفات|الملفات)/.test(normalized)) return { type: 'advanced-search', filters: { sort: 'largest' } };
  if (/^(?:اعرض|عرض).*(?:الاكثر|الأكثر).*(?:مشاهدة|مشاهده)/.test(normalized)) return { type: 'advanced-search', filters: { sort: 'most-viewed' } };

  if (/^(?:اعرض|عرض|وريني|اريني|اظهر|أظهر).*(?:فيديوهات|الفيديوهات|ملفات|الملفات|مكتبة|المكتبه)/.test(normalized) || /^(?:كم|عدد).*(?:فيديو|فيديوهات|ملف|ملفات)/.test(normalized)) {
    return { type: 'list' };
  }

  const removeDraft = command.match(/^(?:احذف|امسح)\s+(?:المسودة|مسودة)(?:\s+الحالية)?\s*$/i);
  if (removeDraft) return { type: 'delete-draft' };

  const renameDraft = command.match(/^(?:غير|غيّر|عدل|عدّل)\s+(?:عنوان\s+)?(?:المسودة|مسودة)(?:\s+إلى|\s+لـ|\s+ل)\s+(.+)$/i);
  if (renameDraft) {
    const title = stripQuotes(renameDraft[1]);
    return title ? { type: 'rename-draft', title } : { type: 'help' };
  }

  const search = command.match(/^(?:ابحث|دور|دوّر|فتش)(?:\s+(?:عن|في))?\s+(.+)$/i);
  if (search) {
    const searchText = stripQuotes(search[1]);
    const folder = searchText.match(/^(.+?)\s+في\s+(?:مجلد|فولدر)\s+(.+)$/i);
    const query = stripQuotes(folder ? folder[1] : searchText);
    return query ? { type: 'search', query, filters: folder ? { folder: stripQuotes(folder[2]) } : undefined } : { type: 'help' };
  }

  // "انشر" is a separate, more consequential verb from جهز/حضر/انشئ: it
  // publishes straight to the live site behind a confirm step (see
  // publish-draft handling in pages/api/ai/chat.js), while the others only
  // ever stage a local draft with no confirmation needed.
  const publish = command.match(/^(?:انشر)\s+(?:(?:مسودة|منشور)\s+)?(.+)$/i);
  if (publish) {
    const query = stripQuotes(publish[1]).trim();
    return query ? { type: 'publish-draft', query } : { type: 'help' };
  }

  const prepare = command.match(/^(?:جهز|جهّز|حضر|حضّر|انشئ|أنشئ)\s+(?:(?:مسودة|منشور)\s+)?(.+)$/i);
  if (prepare) {
    const query = stripQuotes(prepare[1]).replace(/^(?:نشر|النشر)\s+/i, '').trim();
    return query ? { type: 'prepare-draft', query } : { type: 'help' };
  }

  return matchTrainedCommand(command, null) || { type: 'help' };
}

// Video titles in this library follow "{Series} - الحلقة {N}" (see the AI
// title generator and manual-upload convention) — used only to prefill the
// series field on a direct publish. Best-effort: an unmatched title just
// means the field is left blank on the published post, same as a manual
// publish where the field was skipped.
function guessSeriesFromTitle(title) {
  const value = String(title || '').trim();
  if (!value) return '';
  const match = value.match(/^(.+?)\s*[-–—:]\s*(?:الحلقة|حلقة|ep(?:isode)?\.?)\s*#?\s*\d+/i);
  return match ? stripQuotes(match[1]) : '';
}

// Companion to guessSeriesFromTitle — pulls the episode number out of the
// same "{Series} - الحلقة {N}" shape, used only to pass along to the
// synopsis lookup so an episode-level publish gets an episode-level
// summary instead of the whole series' blurb.
function guessEpisodeFromTitle(title) {
  const match = String(title || '').match(/(?:الحلقة|حلقة|ep(?:isode)?\.?)\s*#?\s*(\d{1,3})/i);
  return match ? match[1] : '';
}

function isExplicitHelpCommand(value) {
  const command = normalizeText(value);
  return /^(?:مساعدة|ساعدني|الاوامر|اوامر|وش تقدر|ماذا تستطيع)/.test(command);
}

// A command is collected only when the deterministic parser found no intent.
// Explicit help requests and empty messages are not learning candidates.
function isUnrecognizedLocalCommand(value, parsed) {
  return Boolean(normalizeText(value)) && parsed?.type === 'help' && !isExplicitHelpCommand(value);
}

function helpText() {
  return 'أنا منفذ أوامر محلي مجاني، ولا أستخدم Gemini. جرّب: «اعرض الفيديوهات»، «ابحث عن One Piece»، «جهّز نشر الحلقة 1 من One Piece» لتجهيز مسودة تراجعها بنفسك قبل الحفظ، «انشر الحلقة 1 من One Piece» لطلب نشرها على الموقع مباشرة (سيطلب تأكيدًا قبل التنفيذ، ويحاول جلب ملخص حقيقي للوصف تلقائيًا)، «حمل وانشر <رابط> باسم <عنوان>» لتحميل فيديو جديد ونشره تلقائيًا فور اكتمال التحميل بلا تأكيد إضافي، «حمل وانشر حلقات One Piece من 501: <رابط> <رابط> <رابط>» لتحميل ونشر عدة حلقات دفعة واحدة بترقيم تلقائي متتابع (حتى 15 رابطًا في الأمر الواحد)، «غيّر عناوين One Piece حسب الحجم: 501=334.66, 502=310.2» لتصحيح عناوين فيديوهات مرفوعة بعنوان عام مثل «1080p» بمطابقة الحجم (سيعرض المقترحات ويطلب تأكيدًا قبل أي تغيير فعلي على Vidmoly)، أو «عاوز ملخص الحلقة الأولى من العتاولة من السينما.كوم». سأعرض النص المنشور للحلقة مع المصدر، لا ملخصًا مولدًا. يمكنك أيضًا تعليم عباراتك الخاصة من أعلى الصفحة.';
}

module.exports = { createLocalDraft, guessEpisodeFromTitle, guessSeriesFromTitle, helpText, isUnrecognizedLocalCommand, parseLocalCommand };
