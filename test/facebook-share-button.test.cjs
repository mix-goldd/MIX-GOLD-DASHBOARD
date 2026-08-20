const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('pages/watch/[slug].js', 'utf8');

test('watch page opens Facebook share composer instead of site watch link', () => {
  assert.match(source, /https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/);
  assert.match(source, /VERCEL_URL/);
  assert.match(source, /x-forwarded-host/);
  assert.match(source, /مشاركة المنشور/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.doesNotMatch(source, /مشاهدة على الموقع/);
  assert.doesNotMatch(source, /facebookShareUrl \?/);
  assert.match(source, /`\$\{siteUrl\}\/post\/\$\{slug\}`/);
});

test('watch page keeps download action and public preview metadata', () => {
  assert.match(source, /تحميل/);
  assert.match(source, /og:image/);
  assert.match(source, /og:title/);
  assert.match(source, /findVidmolyLibraryMatch/);
  assert.match(source, /vidmolyThumbnail \|\| post\.thumbnail_url/);
  assert.match(source, /shareDescription = \[description, canonicalUrl \|\| siteWatchUrl\]/);
});
