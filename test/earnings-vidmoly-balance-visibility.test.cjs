const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardSource = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'dashboard', 'index.js'),
  'utf8'
);

test('بطاقة الأرباح لا تعرض رصيد Vidmoly كصف مستقل', () => {
  assert.doesNotMatch(dashboardSource, /<td>Vidmoly balance<\/td>/);
  assert.doesNotMatch(dashboardSource, /Total combines Vidmoly balance/);
  assert.match(dashboardSource, /<td>Total earnings<\/td>/);
});
