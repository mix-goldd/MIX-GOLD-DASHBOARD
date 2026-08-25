const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('تسميات لوحة المحتوى لا تقيّدها بالأنمي', () => {
  const types = read('lib/animeContent.js');
  const layout = read('components/Layout.js');
  const statistics = read('pages/dashboard/statistics.js');
  const manager = read('pages/dashboard/content-manager.js');
  const editor = read('pages/dashboard/content.js');
  const settings = read('pages/api/dashboard-settings.js');

  assert.match(types, /label: 'منشور \/ فيديو'/);
  assert.match(types, /label: 'قائمة الفيديوهات'/);
  assert.match(layout, /إحصائيات المحتوى/);
  assert.doesNotMatch(layout, /إحصائيات الأنمي/);
  assert.match(statistics, /أفضل المحتويات أداءً/);
  assert.match(manager, /تصنيفات المحتوى/);
  assert.match(editor, /إضافة محتوى جديد/);
  assert.match(settings, /LEGACY_ANIME_STATISTICS_LABEL/);
  assert.match(settings, /إحصائيات المحتوى/);
});

