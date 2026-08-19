const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard', 'statistics.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');

test('chart selection exposes bucket details and keeps the base bar color', () => {
  assert.match(page, /chartBucketLabel\(i, counts\.length, rangeMs\)/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /activeBar\.label/);
  assert.match(css, /\.am-chart-studio \.am-bar-active \{[^}]*background: #19bfe8/s);
  assert.match(css, /outline: 2px solid #f6f7f8/);
});
