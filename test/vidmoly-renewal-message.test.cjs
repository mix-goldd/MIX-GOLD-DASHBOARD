const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardSource = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'dashboard', 'index.js'),
  'utf8'
);

test('مكتبة Vidmoly تعرض رسالة التجدد المختصرة فقط بدلاً من تحذيرات المصدر والتخزين', () => {
  assert.match(dashboardSource, /nextVidmolyRenewalAt &&/);
  assert.match(dashboardSource, /أقرب تجدد للحصة:/);
  assert.match(dashboardSource, /formatQuotaCountdown\(nextVidmolyRenewalAt\)/);
  assert.doesNotMatch(dashboardSource, /تعذر تحديث بعض حسابات Vidmoly بالكامل/);
  assert.doesNotMatch(dashboardSource, /Storage isn&apos;t showing/);
  assert.doesNotMatch(dashboardSource, /JSON\.stringify\(earnings\.accountRaw\)/);
  assert.doesNotMatch(dashboardSource, /JSON\.stringify\(debugSample\)/);
});
