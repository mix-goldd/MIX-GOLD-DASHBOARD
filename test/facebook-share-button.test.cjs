const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('pages/watch/[slug].js', 'utf8');
const helper = fs.readFileSync('lib/sharePost.js', 'utf8');
const imageProxy = fs.readFileSync('pages/api/share-image.js', 'utf8');

test('watch page shares formatted text through the device share sheet', () => {
  assert.match(source, /navigator\.share/);
  assert.match(source, /window\.matchMedia\?\.\('\(pointer: fine\)'\)/);
  assert.match(source, /facebook\.com\/sharer\/sharer\.php\?u=/);
  assert.match(source, /quote=\$\{encodeURIComponent\(shareText\)\}/);
  assert.match(source, /shareText = buildShareText/);
  assert.match(source, /fetch\(`\/api\/share-image\?url=/);
  assert.match(source, /navigator\.canShare/);
  assert.match(source, /اختر Facebook/);
  assert.doesNotMatch(source, /href=\{facebookShareUrl\}/);
  assert.match(source, /window\.open\(facebookShareUrl, '_blank'/);
});

test('share text preserves title, blank line, summary, blank line, and canonical URL', () => {
  assert.match(helper, /return \[title, description, url\].*join\('\\n\\n'\)/s);
  assert.match(source, /canonicalUrl = siteUrl \? `\$\{siteUrl\}\/post\/\$\{slug\}`/);
  assert.match(source, /aria-label="مشاركة نص المنشور وصورته"/);
});

test('share image proxy only accepts approved HTTPS image hosts', () => {
  assert.match(imageProxy, /ALLOWED_HOSTS/);
  assert.match(imageProxy, /target\.protocol !== 'https:'/);
  assert.match(imageProxy, /contentType\.startsWith\('image\/'\)/);
  assert.match(imageProxy, /Cache-Control/);
});
