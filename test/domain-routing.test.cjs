const assert = require('node:assert/strict');
const test = require('node:test');
const { routeForHost } = require('../lib/domainRouting');

test('يوجه جذر النطاق العام إلى واجهة الموقع لا إلى صفحة دخول اللوحة', () => {
  assert.deepEqual(routeForHost('mix-goldd.vercel.app', '/'), {
    type: 'internal',
    destination: '/site',
  });
});

test('يمنع مسارات لوحة التحكم من الظهور على النطاق العام', () => {
  assert.deepEqual(routeForHost('mix-goldd.vercel.app', '/dashboard/content'), {
    type: 'internal',
    destination: '/site',
  });
  assert.deepEqual(routeForHost('mix-goldd.vercel.app', '/login'), {
    type: 'internal',
    destination: '/site',
  });
});

test('يوجه جذر نطاق لوحة التحكم إلى لوحة التحكم', () => {
  assert.deepEqual(routeForHost('mix-gold-dashboard.vercel.app', '/'), {
    type: 'internal',
    destination: '/dashboard',
  });
});

test('يعيد روابط المنشورات العامة من نطاق اللوحة إلى النطاق العام', () => {
  assert.deepEqual(routeForHost('mix-gold-dashboard.vercel.app', '/post/176jab8'), {
    type: 'external',
    destination: 'https://mix-goldd.vercel.app/post/176jab8',
  });
});
