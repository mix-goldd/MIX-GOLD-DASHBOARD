const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const pageSource = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'dashboard', 'content.js'),
  'utf8'
);
const styles = fs.readFileSync(
  path.join(__dirname, '..', 'styles', 'globals.css'),
  'utf8'
);

test('بطاقة المحتوى تستخدم تخطيطاً مستطيلاً أفقياً مع إجراءات مستقلة', () => {
  assert.match(pageSource, /className="am-post-card-main"/);
  assert.match(pageSource, /className="am-post-card-actions"/);
  assert.match(pageSource, /className="am-publishing-controls"/);
  assert.match(pageSource, /className="btn am-publishing-action"/);
  assert.match(pageSource, /className="am-publishing-action-label"/);
  assert.match(styles, /\.am-post-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(styles, /\.am-post-card-main\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.am-post-img\s*\{[\s\S]*width:\s*94px/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.am-post-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) 26px/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.am-post-img\s*\{[\s\S]*width:\s*76px/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.am-publishing-controls\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.am-publishing-action-label\s*\{\s*display:\s*none/);
});
