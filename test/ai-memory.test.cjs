const dbPath = require.resolve('../lib/db');
const memoryPath = require.resolve('../lib/aiMemory');

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
  delete require.cache[memoryPath];
});

afterEach(() => {
  delete require.cache[dbPath];
  delete require.cache[memoryPath];
});

describe('MIX assistant memory', () => {
  it('keeps approved preferences private to the signed-in user and never stores a raw conversation field', async () => {
    const memory = require('../lib/aiMemory');
    const alice = await memory.addRule('alice', '  اكتب العناوين بالعربية المباشرة  ');
    await memory.addRule('bob', 'استخدم الإنجليزية فقط');

    expect(alice.rules).toHaveLength(1);
    expect(alice.rules[0]).toMatchObject({ text: 'اكتب العناوين بالعربية المباشرة', source: 'manual' });
    expect(alice.rules[0]).not.toHaveProperty('messages');
    expect((await memory.getMemory('alice')).rules).toHaveLength(1);
    expect((await memory.getMemory('bob')).rules[0].text).toBe('استخدم الإنجليزية فقط');
  });

  it('allows an approved rule to be edited and deleted', async () => {
    const memory = require('../lib/aiMemory');
    const created = await memory.addRule('owner', 'اجعل الملخص قصيرًا');
    const id = created.rules[0].id;
    const edited = await memory.updateRule('owner', id, 'اجعل الملخص قصيرًا وبالعربية');
    expect(edited.rules[0].text).toBe('اجعل الملخص قصيرًا وبالعربية');
    const emptied = await memory.deleteRule('owner', id);
    expect(emptied.rules).toEqual([]);
  });

  it('formats only approved rules as a bounded assistant context', () => {
    const { buildMemoryInstruction } = require('../lib/aiMemory');
    const prompt = buildMemoryInstruction({
      rules: [{ id: 'r1', text: 'اسأل قبل أي نشر', source: 'manual', createdAt: '2026-08-26T00:00:00.000Z' }],
    });
    expect(prompt).toContain('اسأل قبل أي نشر');
    expect(prompt).toContain('لا تعتبرها صلاحيات إضافية');
    expect(prompt).not.toContain('createdAt');
  });
});
