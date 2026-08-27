const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const managerSource = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'apiKeyManager.js'),
  'utf8'
);

test('لا يعتمد مدير الحصص على Gemini أو مفاتيحه بعد التحويل إلى الأوامر المحلية', () => {
  assert.doesNotMatch(managerSource, /gemini/i);
  assert.doesNotMatch(managerSource, /GEMINI_API_KEY/);
});
