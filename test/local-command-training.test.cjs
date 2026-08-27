const fs = require('node:fs');
const path = require('node:path');

const dbPath = require.resolve('../lib/db');
const trainingPath = require.resolve('../lib/localCommandTraining');
const assistantPath = require.resolve('../lib/localCommandAssistant');

let saved;

beforeEach(() => {
  saved = new Map();
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getDashboardSetting: vi.fn(async (key) => saved.get(key) ?? null),
      saveDashboardSetting: vi.fn(async (key, value) => saved.set(key, value)),
    },
  };
  delete require.cache[trainingPath];
  delete require.cache[assistantPath];
});

afterEach(() => {
  delete require.cache[dbPath];
  delete require.cache[trainingPath];
  delete require.cache[assistantPath];
});

describe('Local command training', () => {
  it('stores only bounded command examples under a private key for the signed-in user', async () => {
    const training = require('../lib/localCommandTraining');
    const alice = await training.addTrainingExample('alice', { phrase: '  هات المكتبة  ', action: 'list' });
    await training.addTrainingExample('bob', { phrase: 'لقّي {title}', action: 'search' });

    expect(alice.examples).toHaveLength(1);
    expect(alice.examples[0]).toMatchObject({ phrase: 'هات المكتبة', action: 'list', query: null });
    expect(alice.examples[0]).not.toHaveProperty('messages');
    expect((await training.getTraining('alice')).examples).toHaveLength(1);
    expect((await training.getTraining('alice')).builtInExamples.length).toBeGreaterThan(20);
    expect((await training.getTraining('bob')).examples[0]).toMatchObject({ phrase: 'لقي {title}', action: 'search' });
    expect([...saved.keys()]).toEqual(expect.arrayContaining(['local_command_training_v1:alice', 'local_command_training_v1:bob']));
  });

  it('updates and deletes an example without crossing the signed-in user boundary', async () => {
    const training = require('../lib/localCommandTraining');
    const created = await training.addTrainingExample('owner', { phrase: 'هات المكتبة', action: 'list' });
    const id = created.examples[0].id;
    const edited = await training.updateTrainingExample('owner', id, { phrase: 'اعرض مكتبتي', action: 'list' });
    expect(edited.examples[0]).toMatchObject({ id, phrase: 'اعرض مكتبتي', action: 'list' });
    const emptied = await training.deleteTrainingExample('owner', id);
    expect(emptied.examples).toEqual([]);
  });

  it('allows only whitelisted safe actions and requires a query when one is static', async () => {
    const training = require('../lib/localCommandTraining');
    await expect(training.addTrainingExample('owner', { phrase: 'احذف كل شيء', action: 'delete-video' })).rejects.toThrow('غير مسموح');
    await expect(training.addTrainingExample('owner', { phrase: 'لقّي {title}', action: 'list' })).rejects.toThrow('لا يحتاج');
    await expect(training.addTrainingExample('owner', { phrase: 'ابحث الآن', action: 'search' })).rejects.toThrow('عنوان البحث مطلوب');
    await expect(training.addTrainingExample('owner', { phrase: '{title}', action: 'search' })).rejects.toThrow('كلمات ثابتة');
  });

  it('matches only exact normalized phrases and explicit title templates', () => {
    const { matchTrainedCommand } = require('../lib/localCommandTraining');
    const training = {
      examples: [
        { id: 'list-1', phrase: 'هات المكتبة', action: 'list' },
        { id: 'search-1', phrase: 'لقي {title}', action: 'search' },
        { id: 'draft-1', phrase: 'جهز لي {title}', action: 'prepare-draft' },
      ],
    };

    expect(matchTrainedCommand('هات    المكتبة', training)).toEqual({ type: 'list', trainingId: 'list-1' });
    expect(matchTrainedCommand('لقّي One Piece', training)).toEqual({ type: 'search', query: 'one piece', trainingId: 'search-1' });
    expect(matchTrainedCommand('جهز لي الحلقة 1 من One Piece', training)).toEqual({ type: 'prepare-draft', query: 'الحلقة 1 من one piece', trainingId: 'draft-1' });
    expect(matchTrainedCommand('من فضلك هات المكتبة', training)).toBeNull();
    expect(matchTrainedCommand('لقّي', training)).toBeNull();
  });

  it('ships a reviewed local shortcut pack without treating it as a user-confirmed phrase', async () => {
    const { getTraining, matchTrainedCommand } = require('../lib/localCommandTraining');
    const training = await getTraining('owner');

    expect(training.examples).toEqual([]);
    expect(training.builtInExamples.length).toBeGreaterThanOrEqual(25);
    expect(matchTrainedCommand('هات مكتبتي', training)).toEqual({ type: 'list', trainingId: 'builtin-list-my-library', builtIn: true });
    expect(matchTrainedCommand('دور على One Piece', training)).toEqual({ type: 'search', query: 'one piece', trainingId: 'builtin-search-find', builtIn: true });
    expect(matchTrainedCommand('جهزلي الحلقة 1', training)).toEqual({ type: 'prepare-draft', query: 'الحلقة 1', trainingId: 'builtin-draft-prepare-me', builtIn: true });
  });

  it('supports a thousand confirmed phrases and reports progress without retaining more', () => {
    const { MAX_TRAINING_EXAMPLES, getTrainingProgress, normalizeTraining } = require('../lib/localCommandTraining');
    const examples = Array.from({ length: MAX_TRAINING_EXAMPLES + 8 }, (_, index) => ({
      id: `training-${index}`,
      phrase: `عبارة ثابتة ${index}`,
      action: 'list',
    }));
    const normalized = normalizeTraining({ examples });
    const progress = getTrainingProgress(normalized);

    expect(MAX_TRAINING_EXAMPLES).toBe(1000);
    expect(normalized.examples).toHaveLength(1000);
    expect(progress).toMatchObject({ target: 1000, confirmed: 1000, percent: 100, goalReached: true, level: 'الهدف مكتمل' });
  });

  it('records an unrecognized phrase for review, deduplicates it, and requires an explicit safe action to approve it', async () => {
    const training = require('../lib/localCommandTraining');
    const first = await training.recordUnrecognizedPhrase('owner', '  قول لي المكتبة  ');
    const repeated = await training.recordUnrecognizedPhrase('owner', 'قول   لي المكتبة');
    const pending = (await training.getTraining('owner')).pending[0];

    expect(first.recorded).toBe(true);
    expect(repeated.recorded).toBe(true);
    expect(pending).toMatchObject({ phrase: 'قول لي المكتبة', seenCount: 2 });
    await expect(training.approvePendingPhrase('owner', pending.id, { action: 'delete-video' })).rejects.toThrow('غير مسموح');
    const approved = await training.approvePendingPhrase('owner', pending.id, { action: 'list' });
    expect(approved.pending).toEqual([]);
    expect(approved.examples[0]).toMatchObject({ phrase: 'قول لي المكتبة', action: 'list' });
  });

  it('does not collect URLs or likely secrets as phrase candidates and keeps pending phrases private', async () => {
    const training = require('../lib/localCommandTraining');
    const secretLike = await training.recordUnrecognizedPhrase('alice', 'token abcdefghijklmnopqrstuvwxyz123456');
    const urlLike = await training.recordUnrecognizedPhrase('alice', 'https://example.com/private');
    await training.recordUnrecognizedPhrase('alice', 'قول لي المكتبة');

    expect(secretLike.recorded).toBe(false);
    expect(urlLike.recorded).toBe(false);
    expect((await training.getTraining('alice')).pending).toHaveLength(1);
    expect((await training.getTraining('bob')).pending).toEqual([]);
  });

  it('passes trained intents into the existing draft-only command contract', () => {
    const { parseLocalCommand } = require('../lib/localCommandAssistant');
    const parsed = parseLocalCommand('جهز لي One Piece', {
      examples: [{ id: 'draft-1', phrase: 'جهز لي {title}', action: 'prepare-draft' }],
    });
    expect(parsed).toEqual({ type: 'prepare-draft', query: 'one piece', trainingId: 'draft-1', learned: true });
    expect(parsed.type).not.toBe('publish');
    expect(parsed.type).not.toBe('delete-video');
  });

  it('keeps the command route local, snapshot-only, and provider-free after training is loaded', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'ai', 'chat.js'), 'utf8');
    expect(source).toContain('getTraining(session.id)');
    expect(source).toContain("getDashboardSetting(LIBRARY_SNAPSHOT_KEY)");
    expect(source).not.toContain("require('../../../lib/gemini')");
    expect(source).not.toContain('generateContent(');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('vidmoly.');
    expect(source).toContain('recordUnrecognizedPhrase(session.id, command)');
  });

  it('keeps training management limited to local command actions and requires confirmation before removing a saved phrase', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'ai', 'training.js'), 'utf8');
    const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard', 'ai-chat.js'), 'utf8');
    expect(apiSource).toContain("req.method === 'GET'");
    expect(apiSource).toContain("req.method === 'POST'");
    expect(apiSource).toContain("req.method === 'PATCH'");
    expect(apiSource).toContain("req.method === 'DELETE'");
    expect(apiSource).toContain("operation === 'approve-pending'");
    expect(apiSource).toContain("operation === 'dismiss-pending'");
    expect(pageSource).toContain('window.confirm(');
    expect(pageSource).toContain('فُهمت من عبارة علّمتها');
    expect(pageSource).toContain('عبارات للمراجعة');
    expect(pageSource).toContain('حزمة الاختصارات الجاهزة');
    expect(pageSource).toContain('target: 1000');
  });
});
