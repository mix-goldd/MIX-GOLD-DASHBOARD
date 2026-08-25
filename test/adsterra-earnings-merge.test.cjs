const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('earnings endpoint merges historical Adsterra revenue with Vidmoly in one total', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/doodstream/earnings.js'), 'utf8');
  assert.match(source, /adsterra\.getEarningsSummary/);
  assert.match(source, /total:\s*\(vidmolyBalance \+ adsterraEarnings\.historicalTotal\)/);
  assert.match(source, /today:\s*\(vidmolyToday \+ adsterraEarnings\.today\)/);
  assert.match(source, /earningsSources/);
  assert.doesNotMatch(source, /^\s{2,}const adsterra\s*=/m);
});

test('Adsterra refresh is isolated from temporary Vidmoly quota failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/doodstream/earnings.js'), 'utf8');
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /accountAttempt\.status === 'fulfilled'/);
  assert.match(source, /adsterraAttempt\.status === 'fulfilled'/);
  assert.match(source, /vidmolyError/);
});

test('Adsterra client keeps the API key server-side', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/adsterra.js'), 'utf8');
  assert.match(source, /process\.env\.ADSTERRA_API_KEY/);
  assert.doesNotMatch(source, /7e00e992212f36894d210623d9902af7/);
  assert.match(source, /X-API-Key/);
  assert.match(source, /group_by:\s*'date'/);
});

test('Adsterra client reads the documented items array from Statistics responses', () => {
  const { rowsFromPayload, revenueFromPayload, getEarningsSummary } = require('../lib/adsterra');
  const payload = { items: [{ date: '2026-08-25', revenue: 0.15 }] };
  assert.deepEqual(rowsFromPayload(payload), payload.items);
  assert.equal(revenueFromPayload(payload), 0.15);
  assert.equal(typeof getEarningsSummary, 'function');
});
