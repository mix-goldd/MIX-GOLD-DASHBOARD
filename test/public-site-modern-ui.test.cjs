const fs = require('fs');
const path = require('path');

const publicSiteSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'site', 'index.html'),
  'utf8',
);

describe('واجهة الموقع العام الحديثة', () => {
  it('تستخدم شعار MIX GOLD الحديث ولا تعود إلى شعار PulseX القديم', () => {
    expect(publicSiteSource).toContain('/site/assets/mix-gold-logo.webp');
    expect(publicSiteSource).not.toContain('KAz9Ybt.jpg');
  });

  it('تحتفظ بصور البطاقات عبر مسار احتياطي محلي عند تعذر الرابط الخارجي', () => {
    expect(publicSiteSource).toContain("const preferredThumbnail = relationMedia.thumbnail || post.thumbnail_url || legacyImages[0] || '/site/assets/default-post-cover.webp'");
    expect(publicSiteSource).toContain("img.src = '/site/assets/default-post-cover.webp'");
    expect(publicSiteSource).toContain("img.referrerPolicy = 'no-referrer'");
  });

  it('تدعم تسمية رقم الحلقة داخل بطاقات المنشورات', () => {
    expect(publicSiteSource).toContain('post-title-episode');
    expect(publicSiteSource).toContain('(?:الحلقة|حلقة|episode|ep\\.)');
  });

  it('لا تنشر عنوان S-E الخاص بالواجهة القديمة', () => {
    expect(publicSiteSource).not.toContain('<title>S-E</title>');
  });
});
