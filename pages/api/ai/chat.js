// Deterministic local command executor. It deliberately reads only the durable
// Vidmoly library snapshot and never asks Gemini or Vidmoly for fresh data.
const { requireAuth } = require('../../../lib/api-auth');
const { getDashboardSetting } = require('../../../lib/db');
const { collectLibraryFiles, findVidmolyLibraryMatch, normalizeText, scoreMatch } = require('../../../lib/vidmolyLibraryMatch');
const { createLocalDraft, helpText, parseLocalCommand } = require('../../../lib/localCommandAssistant');

const LIBRARY_SNAPSHOT_KEY = 'vidmoly_library_snapshot_v1';

function publicFile(item) {
  return {
    title: item.title || item.name || item.file_title || item.file_name || 'بدون عنوان',
    file_code: item.file_code || item.filecode || item.code || item.fileCode || '',
    duration: item.length || item.duration || '',
    thumbnail_url: item.thumb || item.single_img || item.thumbnail_url || '',
  };
}

function findMatches(query, snapshot, limit = 6) {
  return collectLibraryFiles(snapshot?.payload || snapshot)
    .map((item) => ({ item, score: scoreMatch(query, item) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => publicFile(item));
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
  const parsed = parseLocalCommand(command);

  if (parsed.type === 'help') return res.status(200).json({ text: helpText(), results: [] });
  if (parsed.type === 'rename-draft') {
    if (!activeDraft?.title) return res.status(200).json({ text: 'لا توجد مسودة محلية لتعديلها. جهّز منشورًا من فيديو أولًا.', action: 'none', results: [] });
    return res.status(200).json({
      text: `سيُغيَّر عنوان المسودة إلى: ${parsed.title}`,
      action: 'rename-draft',
      draft: { ...activeDraft, title: parsed.title },
      results: [],
    });
  }
  if (parsed.type === 'delete-draft') {
    if (!activeDraft?.title) return res.status(200).json({ text: 'لا توجد مسودة محلية لحذفها.', action: 'none', results: [] });
    return res.status(200).json({ text: `سيُحذف تجهيز المسودة «${activeDraft.title}» فقط، ولن يُحذف أي فيديو أو منشور منشور.`, action: 'delete-draft', results: [] });
  }

  let snapshot;
  try {
    snapshot = await getDashboardSetting(LIBRARY_SNAPSHOT_KEY);
  } catch (error) {
    return res.status(503).json({ error: 'تعذر قراءة نسخة مكتبة الفيديوهات المخزنة.' });
  }
  const files = collectLibraryFiles(snapshot?.payload || snapshot);
  if (!files.length) return res.status(200).json(snapshotUnavailable());

  if (parsed.type === 'list') {
    const results = files.slice(0, 12).map(publicFile);
    return res.status(200).json({
      text: `توجد ${files.length} فيديوهات في النسخة المخزنة محليًا. هذه أحدث ${results.length} عناصر:`,
      action: 'list',
      results,
    });
  }

  const matches = findMatches(parsed.query, snapshot);
  if (parsed.type === 'search') {
    return res.status(200).json({
      text: matches.length ? `وجدت ${matches.length} نتيجة محلية لعبارة «${parsed.query}».` : `لم أجد نتيجة محلية لعبارة «${parsed.query}».`,
      action: 'search',
      results: matches,
    });
  }

  const matched = findVidmolyLibraryMatch(parsed.query, snapshot?.payload || snapshot);
  if (!matched) {
    return res.status(200).json({ text: `لم أجد فيديو مناسبًا لتجهيز مسودة «${parsed.query}». جرّب أمر بحث باسم أقصر أو أدق.`, action: 'prepare-draft', results: matches });
  }
  const draft = createLocalDraft(matched);
  return res.status(200).json({
    text: `تم تجهيز مسودة محلية من «${draft.title}». لن يُنشأ أو يُنشر أي محتوى حتى تفتح النموذج وتضغط الحفظ بنفسك.`,
    action: 'prepare-draft',
    draft,
    results: [publicFile(matched)],
  });
}
