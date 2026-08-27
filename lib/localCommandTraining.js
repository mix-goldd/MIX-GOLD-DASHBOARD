const crypto = require('crypto');
const { getDashboardSetting, saveDashboardSetting } = require('./db');
const { normalizeText } = require('./vidmolyLibraryMatch');

const MAX_TRAINING_EXAMPLES = 60;
const MAX_PHRASE_LENGTH = 160;
const MAX_QUERY_LENGTH = 220;
const KEY_PREFIX = 'local_command_training_v1';
const TITLE_PLACEHOLDER = '{title}';
const ALLOWED_ACTIONS = new Set(['list', 'search', 'prepare-draft']);

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
  const query = cleanInput(value, 'عنوان البحث', MAX_QUERY_LENGTH);
  return query;
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
  return { version: 1, examples };
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

function assertPhraseAvailable(examples, phrase, excludedId = null) {
  if (examples.some((example) => example.id !== excludedId && example.phrase === phrase)) {
    throw new Error('هذه العبارة موجودة بالفعل. عدّل المثال الحالي أو استخدم عبارة مختلفة.');
  }
}

async function getTraining(userId) {
  return normalizeTraining(await getDashboardSetting(trainingKey(userId)));
}

async function saveTraining(userId, training) {
  const normalized = normalizeTraining(training);
  await saveDashboardSetting(trainingKey(userId), normalized);
  return normalized;
}

async function addTrainingExample(userId, payload) {
  const training = await getTraining(userId);
  if (training.examples.length >= MAX_TRAINING_EXAMPLES) {
    throw new Error(`يمكن حفظ ${MAX_TRAINING_EXAMPLES} عبارة كحد أقصى. احذف مثالًا قديمًا أولًا.`);
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

function trainedAction(example, query) {
  if (example.action === 'list') return { type: 'list', trainingId: example.id };
  return { type: example.action, query, trainingId: example.id };
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

// Training is deliberately exact: a saved phrase must match after the same
// normalization used for library titles. Templates only expand an explicit
// {title} field and never perform fuzzy intent guessing.
function matchTrainedCommand(value, training) {
  const command = normalizeText(value);
  if (!command) return null;
  const examples = normalizeTraining(training).examples;

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

module.exports = {
  ALLOWED_ACTIONS,
  MAX_PHRASE_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_TRAINING_EXAMPLES,
  addTrainingExample,
  deleteTrainingExample,
  getTraining,
  matchTrainedCommand,
  normalizeTraining,
  updateTrainingExample,
};
