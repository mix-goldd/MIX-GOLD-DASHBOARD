const fs = require('fs');
const path = require('path');

const publicSiteSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'site', 'index.html'),
  'utf8',
);

describe('واجهة الموقع العام الحديثة', () => {
  it('تستخدم شعار MIX GOLD الحديث ولا تعود إلى شعار PulseX القديم', () => {
    expect(publicSiteSource).toContain('Picsart-26-08-17-15-37-39-933.png');
    expect(publicSiteSource).not.toContain('KAz9Ybt.jpg');
  });

  it('تدعم تسمية رقم الحلقة داخل بطاقات المنشورات', () => {
    expect(publicSiteSource).toContain('post-title-episode');
    expect(publicSiteSource).toContain('(?:الحلقة|حلقة|episode|ep\\.)');
  });

  it('لا تنشر عنوان S-E الخاص بالواجهة القديمة', () => {
    expect(publicSiteSource).not.toContain('<title>S-E</title>');
  });
});
