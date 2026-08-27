// Deterministic local command executor. It deliberately reads only the durable
// Vidmoly library snapshot and never asks Gemini or Vidmoly for fresh data.
const { requireAuth } = require('../../../lib/api-auth');
const { getDashboardSetting } = require('../../../lib/db');
const { collectLibraryFiles, findAdvancedLibraryMatches, findVidmolyLibraryMatch, getLibraryItemDetails } = require('../../../lib/vidmolyLibraryMatch');
const { createLocalDraft, helpText, isUnrecognizedLocalCommand, parseLocalCommand } = require('../../../lib/localCommandAssistant');
const { getTraining, recordUnrecognizedPhrase } = require('../../../lib/localCommandTraining');

const LIBRARY_SNAPSHOT_KEY = 'vidmoly_library_snapshot_v1';

function publicFile(item) {
  return getLibraryItemDetails(item);
}

function getAdvancedSearchInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    query: typeof value.query === 'string' ? value.query : '',
    folder: typeof value.folder === 'string' ? value.folder : '',
    sort: typeof value.sort === 'string' ? value.sort : 'relevance',
    minViews: value.minViews,
    minSizeMb: value.minSizeMb,
  };
}

function snapshotUnavailable() {
  return {
    text: 'لا توجد نسخة محلية من مكتبة Vidmoly الآن. افتح صفحة الفيديوهات لاحقًا لتظهر آخر البيانات المخزنة؛ لن أرسل طلبًا جديدًا إلى Vidmoly من هذه الصفحة.',
    results: [],
  };
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const command = typeof req.body?.command === 'string' ? req.body.command : '';
  const activeDraft = req.body?.draft && typeof req.body.draft === 'object' ? req.body.draft : null;
  const requestedAdvancedSearch = getAdvancedSearchInput(req.body?.advancedSearch);
  let training = null;
  try {
    training = await getTraining(session.id);
  } catch (error) {
    // Training is optional: the original local commands remain available if
    // its saved setting is temporarily unavailable.
    training = null;
  }
  const parsed = requestedAdvancedSearch
    ? { type: 'advanced-search', filters: requestedAdvancedSearch }
    : parseLocalCommand(command, training);
  const learned = Boolean(parsed.learned);
  const builtIn = Boolean(parsed.builtIn);

  let suggestionRecorded = false;
  if (isUnrecognizedLocalCommand(command, parsed)) {
    try {
      const recorded = await recordUnrecognizedPhrase(session.id, command);
      suggestionRecorded = Boolean(recorded.recorded);
    } catch (error) {
      // The command remains a safe help response if optional phrase collection
      // is unavailable; no command intent is guessed as a fallback.
      suggestionRecorded = false;
    }
  }

  if (parsed.type === 'help') {
    const text = suggestionRecorded
      ? `${helpText()} سجّلت عبارتك في «عبارات للمراجعة» لتختار معناها لاحقًا.`
      : helpText();
    return res.status(200).json({ text, learned, builtIn, suggestionRecorded, results: [] });
  }
  if (parsed.type === 'rename-draft') {
    if (!activeDraft?.title) return res.status(200).json({ text: 'لا توجد مسودة محلية لتعديلها. جهّز منشورًا من فيديو أولًا.', action: 'none', learned, builtIn, results: [] });
    return res.status(200).json({
      text: `سيُغيَّر عنوان المسودة إلى: ${parsed.title}`,
      action: 'rename-draft',
      learned,
      builtIn,
      draft: { ...activeDraft, title: parsed.title },
      results: [],
    });
  }
  if (parsed.type === 'delete-draft') {
    if (!activeDraft?.title) return res.status(200).json({ text: 'لا توجد مسودة محلية لحذفها.', action: 'none', learned, builtIn, results: [] });
    return res.status(200).json({ text: `سيُحذف تجهيز المسودة «${activeDraft.title}» فقط، ولن يُحذف أي فيديو أو منشور منشور.`, action: 'delete-draft', learned, builtIn, results: [] });
  }
  if (parsed.type === 'external-synopsis') {
    return res.status(200).json({
      text: `جارٍ التحقق من النص المنشور لـ${parsed.episode ? `الحلقة ${parsed.episode} من ` : ''}«${parsed.title}» في مصدر عام مستقل. لن أقرأ مكتبة Vidmoly ولن أُنشئ مسودة أو منشورًا.`,
      action: 'external-synopsis',
      synopsisRequest: { title: parsed.title, episode: parsed.episode || undefined },
      learned,
      builtIn,
      results: [],
    });
  }

  let snapshot;
  try {
    snapshot = await getDashboardSetting(LIBRARY_SNAPSHOT_KEY);
  } catch (error) {
    return res.status(503).json({ error: 'تعذر قراءة نسخة مكتبة الفيديوهات المخزنة.' });
  }
  const files = collectLibraryFiles(snapshot?.payload || snapshot);
  if (!files.length) return res.status(200).json({ ...snapshotUnavailable(), learned, builtIn });

  if (parsed.type === 'list') {
    const results = files.slice(0, 12).map(publicFile);
    return res.status(200).json({
      text: `توجد ${files.length} فيديوهات في النسخة المخزنة محليًا. هذه أحدث ${results.length} عناصر:`,
      action: 'list',
      learned,
      builtIn,
      results,
    });
  }

  const advanced = findAdvancedLibraryMatches(snapshot?.payload || snapshot, {
    query: parsed.query || '',
    ...(parsed.filters || {}),
  }, parsed.type === 'details' ? 1 : 12);
  const matches = advanced.results;
  if (parsed.type === 'advanced-search') {
    const sortLabels = { relevance: 'الأكثر صلة', newest: 'الأحدث رفعًا', largest: 'الأكبر حجمًا', 'most-viewed': 'الأكثر مشاهدة' };
    const filterBits = [advanced.filters.folder ? `المجلد «${advanced.filters.folder}»` : '', advanced.filters.minViews ? `على الأقل ${advanced.filters.minViews} مشاهدة` : '', advanced.filters.minSizeMb ? `على الأقل ${advanced.filters.minSizeMb} م.ب` : ''].filter(Boolean);
    return res.status(200).json({
      text: matches.length
        ? `وجدت ${matches.length} نتيجة محلية مرتبة حسب ${sortLabels[advanced.filters.sort] || sortLabels.relevance}${filterBits.length ? `، مع فلتر ${filterBits.join(' و')}` : ''}.`
        : 'لا توجد نتائج محلية مطابقة للفلاتر المحددة.',
      action: 'advanced-search',
      learned,
      builtIn,
      results: matches,
    });
  }
  if (parsed.type === 'details') {
    return res.status(200).json({
      text: matches.length ? `هذه التفاصيل المخزنة محليًا للفيديو الأقرب إلى «${parsed.query}».` : `لم أجد فيديو محليًا باسم «${parsed.query}».`,
      action: 'details',
      learned,
      builtIn,
      results: matches,
    });
  }
  if (parsed.type === 'search') {
    return res.status(200).json({
      text: matches.length ? `وجدت ${matches.length} نتيجة محلية لعبارة «${parsed.query}».` : `لم أجد نتيجة محلية لعبارة «${parsed.query}».`,
      action: 'search',
      learned,
      builtIn,
      results: matches,
    });
  }

  const matched = findVidmolyLibraryMatch(parsed.query, snapshot?.payload || snapshot);
  if (!matched) {
    return res.status(200).json({ text: `لم أجد فيديو مناسبًا لتجهيز مسودة «${parsed.query}». جرّب أمر بحث باسم أقصر أو أدق.`, action: 'prepare-draft', learned, builtIn, results: matches });
  }
  const draft = createLocalDraft(matched);
  return res.status(200).json({
    text: `تم تجهيز مسودة محلية من «${draft.title}». لن يُنشأ أو يُنشر أي محتوى حتى تفتح النموذج وتضغط الحفظ بنفسك.`,
    action: 'prepare-draft',
    learned,
    builtIn,
    draft,
    results: [publicFile(matched)],
  });
}
