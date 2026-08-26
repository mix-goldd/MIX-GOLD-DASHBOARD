const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const managerSource = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'apiKeyManager.js'),
  'utf8'
);

test('استخدام اسم مفتاح Gemini الاحتياطي المعرّف في Vercel', () => {
  assert.match(managerSource, /id: 'gemini-2',[\s\S]*env: 'GEMINI_API_KEY_2'/);
  assert.doesNotMatch(managerSource, /GEMINI_API_KEY_SECONDARY/);
});

