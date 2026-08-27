const crypto = require('crypto');
const { getDashboardSetting, saveDashboardSetting } = require('./db');
const { normalizeText } = require('./vidmolyLibraryMatch');

const MAX_TRAINING_EXAMPLES = 1000;
const MAX_PENDING_PHRASES = 400;
const MAX_PHRASE_LENGTH = 160;
const MAX_QUERY_LENGTH = 220;
const KEY_PREFIX = 'local_command_training_v1';
const TITLE_PLACEHOLDER = '{title}';
const ALLOWED_ACTIONS = new Set(['list', 'search', 'prepare-draft']);
const SENSITIVE_PENDING_PATTERN = /(?:api[_ -]?key|token|secret|password|passwd|bearer|authorization|كلمة\s*المرور|باسورد|كود\s*التحقق|مفتاح)/i;
const LONG_TOKEN_PATTERN = /[a-z0-9_-]{24,}/i;

// This pack is intentionally small and finite. It supplies common, reviewed
// shortcuts only; it does not guess a user's intent or contact an AI provider.
const BUILT_IN_COMMAND_PACK = [
  { id: 'builtin-list-library', phrase: 'هات المكتبة', action: 'list' },
  { id: 'builtin-list-my-library', phrase: 'هات مكتبتي', action: 'list' },
  { id: 'builtin-list-show-library', phrase: 'اعرض المكتبة', action: 'list' },
  { id: 'builtin-list-show-my-library', phrase: 'اعرض مكتبتي', action: 'list' },
  { id: 'builtin-list-show-videos', phrase: 'اعرض الفيديوهات', action: 'list' },
  { id: 'builtin-list-get-videos', phrase: 'هات الفيديوهات', action: 'list' },
  { id: 'builtin-list-show-files', phrase: 'اعرض الملفات', action: 'list' },
  { id: 'builtin-list-get-files', phrase: 'هات الملفات', action: 'list' },
  { id: 'builtin-list-show-me-library', phrase: 'وريني المكتبة', action: 'list' },
  { id: 'builtin-list-show-me-my-library', phrase: 'وريني مكتبتي', action: 'list' },
  { id: 'builtin-list-show-me-videos', phrase: 'وريني الفيديوهات', action: 'list' },
  { id: 'builtin-list-display-library', phrase: 'اظهر المكتبة', action: 'list' },
  { id: 'builtin-list-open-library', phrase: 'افتح المكتبة', action: 'list' },
  { id: 'builtin-list-video-count', phrase: 'كم فيديو عندي', action: 'list' },
  { id: 'builtin-list-file-count', phrase: 'كم ملف عندي', action: 'list' },
  { id: 'builtin-search-find', phrase: 'دور على {title}', action: 'search' },
  { id: 'builtin-search-search', phrase: 'ابحث عن {title}', action: 'search' },
  { id: 'builtin-search-look-up', phrase: 'فتش عن {title}', action: 'search' },
  { id: 'builtin-search-find-me', phrase: 'دورلي على {title}', action: 'search' },
  { id: 'builtin-search-search-me', phrase: 'ابحثلي عن {title}', action: 'search' },
  { id: 'builtin-search-locate', phrase: 'لقي {title}', action: 'search' },
  { id: 'builtin-search-locate-me', phrase: 'لقالي {title}', action: 'search' },
  { id: 'builtin-draft-prepare', phrase: 'جهز {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-prepare-me', phrase: 'جهزلي {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-prepare-for-me', phrase: 'جهز لي {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-prepare-post', phrase: 'جهز نشر {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-create', phrase: 'اعمل مسودة {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-create-for-me', phrase: 'اعمل لي مسودة {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-create-post', phrase: 'انشئ مسودة {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-prepare-post-title', phrase: 'جهز منشور {title}', action: 'prepare-draft' },
  { id: 'builtin-draft-write-post', phrase: 'اكتب منشور {title}', action: 'prepare-draft' },
];

function trainingKey(userId) {
  if (userId === undefined || userId === null || userId === '') {
    throw new Error('يلزم تسجيل الدخول لحفظ عبارات التدريب.');
  }
  return `${KEY_PREFIX}:${String(userId)}`;
}

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function cleanInput(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label} مطلوب.`);
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error(`${label} مطلوب.`);
  if (cleaned.length > maxLength) throw new Error(`${label} طويل جدًا.`);
  return cleaned;
}

function normalizePhrase(value) {
  const raw = cleanInput(value, 'العبارة', MAX_PHRASE_LENGTH);
  const placeholderMatches = raw.match(/\{title\}/gi) || [];
  if (placeholderMatches.length > 1) {
    throw new Error('يمكن استخدام {title} مرة واحدة فقط داخل العبارة.');
  }
  if (/\{[^}]*\}|[{}]/.test(raw.replace(/\{title\}/gi, ''))) {
    throw new Error('المتغير الوحيد المسموح هو {title}.');
  }

  const parts = raw.split(/\{title\}/gi).map((part) => normalizeText(part));
  const isTemplate = placeholderMatches.length === 1;
  const phrase = isTemplate
    ? `${parts[0]} ${TITLE_PLACEHOLDER} ${parts[1]}`.replace(/\s+/g, ' ').trim()
    : parts[0];

  if (!phrase || phrase === TITLE_PLACEHOLDER) throw new Error('اكتب كلمات ثابتة واضحة داخل العبارة.');
  if (isTemplate && !parts[0]) {
    throw new Error('ضع كلمات ثابتة قبل {title}، مثل: دور على {title}.');
  }
  return { phrase, isTemplate };
}

function normalizeQuery(value) {
  return cleanInput(value, 'عنوان البحث', MAX_QUERY_LENGTH);
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = typeof candidate.id === 'string' ? candidate.id.slice(0, 100) : '';
  const action = typeof candidate.action === 'string' ? candidate.action : '';
  if (!id || !ALLOWED_ACTIONS.has(action)) return null;

  let phraseInfo;
  try {
    phraseInfo = normalizePhrase(candidate.phrase);
  } catch (error) {
    return null;
  }
  if (action === 'list' && phraseInfo.isTemplate) return null;

  let query = null;
  if (action !== 'list' && !phraseInfo.isTemplate) {
    try {
      query = normalizeQuery(candidate.query);
    } catch (error) {
      return null;
    }
  }

  return {
    id,
    phrase: phraseInfo.phrase,
    action,
    query,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : null,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
  };
}

function isSafePendingPhrase(value) {
  if (typeof value !== 'string') return false;
  const raw = value.replace(/\s+/g, ' ').trim();
  if (!raw || raw.length > MAX_PHRASE_LENGTH) return false;
  if (/https?:\/\//i.test(raw) || SENSITIVE_PENDING_PATTERN.test(raw) || LONG_TOKEN_PATTERN.test(raw)) return false;
  return Boolean(normalizeText(raw));
}

function normalizePendingCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || !isSafePendingPhrase(candidate.phrase)) return null;
  const id = typeof candidate.id === 'string' ? candidate.id.slice(0, 100) : '';
  const phrase = candidate.phrase.replace(/\s+/g, ' ').trim();
  const normalizedPhrase = normalizeText(phrase);
  if (!id || !normalizedPhrase) return null;
  const seenCount = Number.isInteger(candidate.seenCount) ? Math.min(Math.max(candidate.seenCount, 1), 9999) : 1;

  return {
    id,
    phrase,
    normalizedPhrase,
    seenCount,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : null,
    lastSeenAt: typeof candidate.lastSeenAt === 'string' ? candidate.lastSeenAt : null,
  };
}

function normalizeTraining(value) {
  const candidates = Array.isArray(value?.examples) ? value.examples : [];
  const ids = new Set();
  const phrases = new Set();
  const examples = [];

  for (const candidate of candidates) {
    const example = normalizeCandidate(candidate);
    if (!example || ids.has(example.id) || phrases.has(example.phrase)) continue;
    ids.add(example.id);
    phrases.add(example.phrase);
    examples.push(example);
    if (examples.length >= MAX_TRAINING_EXAMPLES) break;
  }

  const pendingCandidates = Array.isArray(value?.pending) ? value.pending : [];
  const pendingIds = new Set();
  const pendingPhrases = new Set();
  const pending = [];
  for (const candidate of pendingCandidates) {
    const phrase = normalizePendingCandidate(candidate);
    if (!phrase || pendingIds.has(phrase.id) || pendingPhrases.has(phrase.normalizedPhrase) || phrases.has(phrase.normalizedPhrase)) continue;
    pendingIds.add(phrase.id);
    pendingPhrases.add(phrase.normalizedPhrase);
    pending.push(phrase);
    if (pending.length >= MAX_PENDING_PHRASES) break;
  }

  return { version: 2, examples, pending };
}

function buildExample({ id, phrase, action, query, createdAt, updatedAt }) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error('الإجراء المحدد غير مسموح.');
  const phraseInfo = normalizePhrase(phrase);
  if (action === 'list' && phraseInfo.isTemplate) {
    throw new Error('إجراء عرض المكتبة لا يحتاج {title}.');
  }

  const normalizedQuery = action === 'list' || phraseInfo.isTemplate ? null : normalizeQuery(query);
  return {
    id,
    phrase: phraseInfo.phrase,
    action,
    query: normalizedQuery,
    createdAt,
    updatedAt,
  };
}

function createBuiltInExamples() {
  const seen = new Set();
  return BUILT_IN_COMMAND_PACK.map((entry) => {
    const example = buildExample({ ...entry, createdAt: null, updatedAt: null, query: null });
    return { ...example, builtIn: true };
  }).filter((example) => {
    if (seen.has(example.phrase)) return false;
    seen.add(example.phrase);
    return true;
  });
}

const BUILT_IN_EXAMPLES = createBuiltInExamples();

function assertPhraseAvailable(examples, phrase, excludedId = null) {
  if (examples.some((example) => example.id !== excludedId && example.phrase === phrase)) {
    throw new Error('هذه العبارة موجودة بالفعل. عدّل المثال الحالي أو استخدم عبارة مختلفة.');
  }
}

function getTrainingProgress(training) {
  const normalized = normalizeTraining(training);
  const confirmed = normalized.examples.length;
  const percent = Math.min(100, Math.round((confirmed / MAX_TRAINING_EXAMPLES) * 100));
  const coverage = new Set(normalized.examples.map((example) => example.action));
  let level = 'بداية';
  if (confirmed >= MAX_TRAINING_EXAMPLES) level = 'الهدف مكتمل';
  else if (confirmed >= 600) level = 'قوي';
  else if (confirmed >= 300) level = 'متقدم';
  else if (confirmed >= 100) level = 'جيد';
  else if (confirmed >= 25) level = 'متنامٍ';

  return {
    target: MAX_TRAINING_EXAMPLES,
    confirmed,
    pending: normalized.pending.length,
    builtIn: BUILT_IN_EXAMPLES.length,
    actionCoverage: coverage.size,
    actionTarget: ALLOWED_ACTIONS.size,
    percent,
    level,
    goalReached: confirmed >= MAX_TRAINING_EXAMPLES,
  };
}

function decorateTraining(training) {
  const normalized = normalizeTraining(training);
  return {
    ...normalized,
    builtInExamples: BUILT_IN_EXAMPLES,
    progress: getTrainingProgress(normalized),
  };
}

async function getTraining(userId) {
  return decorateTraining(await getDashboardSetting(trainingKey(userId)));
}

async function saveTraining(userId, training) {
  const normalized = normalizeTraining(training);
  await saveDashboardSetting(trainingKey(userId), normalized);
  return decorateTraining(normalized);
}

async function addTrainingExample(userId, payload) {
  const training = await getTraining(userId);
  if (training.examples.length >= MAX_TRAINING_EXAMPLES) {
    throw new Error(`يمكن حفظ ${MAX_TRAINING_EXAMPLES} عبارة مؤكدة كحد أقصى. احذف مثالًا قديمًا أولًا.`);
  }
  const now = new Date().toISOString();
  const example = buildExample({
    id: newId(),
    phrase: payload?.phrase,
    action: payload?.action,
    query: payload?.query,
    createdAt: now,
    updatedAt: now,
  });
  assertPhraseAvailable(training.examples, example.phrase);
  training.examples.unshift(example);
  return saveTraining(userId, training);
}

async function updateTrainingExample(userId, id, payload) {
  const training = await getTraining(userId);
  const index = training.examples.findIndex((example) => example.id === id);
  if (index === -1) throw new Error('لم يتم العثور على عبارة التدريب.');
  const current = training.examples[index];
  const example = buildExample({
    id: current.id,
    phrase: payload?.phrase,
    action: payload?.action,
    query: payload?.query,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  assertPhraseAvailable(training.examples, example.phrase, current.id);
  training.examples[index] = example;
  return saveTraining(userId, training);
}

async function deleteTrainingExample(userId, id) {
  const training = await getTraining(userId);
  const examples = training.examples.filter((example) => example.id !== id);
  if (examples.length === training.examples.length) throw new Error('لم يتم العثور على عبارة التدريب.');
  return saveTraining(userId, { ...training, examples });
}

async function recordUnrecognizedPhrase(userId, value) {
  if (!isSafePendingPhrase(value)) return { recorded: false, training: null };
  const training = await getTraining(userId);
  const phrase = value.replace(/\s+/g, ' ').trim();
  const normalizedPhrase = normalizeText(phrase);
  const known = [...training.examples, ...BUILT_IN_EXAMPLES].some((example) => example.phrase === normalizedPhrase);
  if (known) return { recorded: false, training };

  const now = new Date().toISOString();
  const existing = training.pending.find((item) => item.normalizedPhrase === normalizedPhrase);
  if (existing) {
    existing.seenCount = Math.min(existing.seenCount + 1, 9999);
    existing.lastSeenAt = now;
  } else {
    if (training.pending.length >= MAX_PENDING_PHRASES) return { recorded: false, training };
    training.pending.unshift({ id: newId(), phrase, normalizedPhrase, seenCount: 1, createdAt: now, lastSeenAt: now });
  }
  return { recorded: true, training: await saveTraining(userId, training) };
}

async function approvePendingPhrase(userId, id, payload) {
  const training = await getTraining(userId);
  const pending = training.pending.find((item) => item.id === id);
  if (!pending) throw new Error('لم يتم العثور على العبارة المقترحة.');
  if (training.examples.length >= MAX_TRAINING_EXAMPLES) {
    throw new Error(`يمكن حفظ ${MAX_TRAINING_EXAMPLES} عبارة مؤكدة كحد أقصى. احذف مثالًا قديمًا أولًا.`);
  }

  const now = new Date().toISOString();
  const example = buildExample({
    id: newId(),
    phrase: payload?.phrase || pending.phrase,
    action: payload?.action,
    query: payload?.query,
    createdAt: now,
    updatedAt: now,
  });
  assertPhraseAvailable(training.examples, example.phrase);
  training.examples.unshift(example);
  training.pending = training.pending.filter((item) => item.id !== id);
  return saveTraining(userId, training);
}

async function dismissPendingPhrase(userId, id) {
  const training = await getTraining(userId);
  const pending = training.pending.filter((item) => item.id !== id);
  if (pending.length === training.pending.length) throw new Error('لم يتم العثور على العبارة المقترحة.');
  return saveTraining(userId, { ...training, pending });
}

function trainedAction(example, query) {
  const action = example.action === 'list'
    ? { type: 'list', trainingId: example.id }
    : { type: example.action, query, trainingId: example.id };
  return example.builtIn ? { ...action, builtIn: true } : action;
}

function matchTemplate(command, example) {
  const [prefix, suffix] = example.phrase.split(TITLE_PLACEHOLDER).map((part) => part.trim());
  const prefixWithSpace = `${prefix} `;
  if (!command.startsWith(prefixWithSpace)) return null;
  let query = command.slice(prefixWithSpace.length).trim();
  if (suffix) {
    const suffixWithSpace = ` ${suffix}`;
    if (!command.endsWith(suffixWithSpace)) return null;
    query = command.slice(prefixWithSpace.length, command.length - suffixWithSpace.length).trim();
  }
  return query || null;
}

function matchExamples(command, examples) {
  for (const example of examples) {
    if (!example.phrase.includes(TITLE_PLACEHOLDER) && example.phrase === command) {
      return trainedAction(example, example.query);
    }
  }
  for (const example of examples) {
    if (!example.phrase.includes(TITLE_PLACEHOLDER)) continue;
    const query = matchTemplate(command, example);
    if (query) return trainedAction(example, query);
  }
  return null;
}

// Training is deliberately exact: a saved phrase must match after the same
// normalization used for library titles. Templates only expand an explicit
// {title} field and never perform fuzzy intent guessing.
function matchTrainedCommand(value, training, { includeBuiltIn = true } = {}) {
  const command = normalizeText(value);
  if (!command) return null;
  const userExamples = normalizeTraining(training).examples;
  return matchExamples(command, userExamples) || (includeBuiltIn ? matchExamples(command, BUILT_IN_EXAMPLES) : null);
}

module.exports = {
  ALLOWED_ACTIONS,
  BUILT_IN_COMMAND_PACK,
  MAX_PENDING_PHRASES,
  MAX_PHRASE_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_TRAINING_EXAMPLES,
  addTrainingExample,
  approvePendingPhrase,
  deleteTrainingExample,
  dismissPendingPhrase,
  getTraining,
  getTrainingProgress,
  isSafePendingPhrase,
  matchTrainedCommand,
  normalizeTraining,
  recordUnrecognizedPhrase,
  updateTrainingExample,
};
