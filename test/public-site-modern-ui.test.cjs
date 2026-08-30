const fs = require('fs');
const path = require('path');

const publicSiteSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'site', 'index.html'),
  'utf8',
);
const sePlatformSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'se-platform.html'),
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

  it('تعتمد البطاقات العمودية الحديثة داخل الموقع الرسمي دون شارة مدة منفصلة', () => {
    expect(publicSiteSource).toContain('image-card official-portrait-card');
    expect(publicSiteSource).toContain('.image-card .image-wrapper');
    expect(publicSiteSource).toContain('aspect-ratio: 2 / 3 !important;');
    expect(publicSiteSource).toContain('wrapper.appendChild(infoDiv);');
    expect(publicSiteSource).toContain('.image-card .duration-badge');
  });

  it('لا يعرض نافذة Agreement أو منطق قبولها في أي صفحة من الموقع الرسمي', () => {
    expect(publicSiteSource).not.toContain('id="agreement-overlay"');
    expect(publicSiteSource).not.toContain('function checkAgreement()');
    expect(publicSiteSource).not.toContain('function acceptAgreement()');
    expect(publicSiteSource).not.toContain('function declineAgreement()');
    expect(publicSiteSource).not.toContain('MIX_GOLD_AGREEMENT_FRAGMENT_KEY');
    expect(publicSiteSource).not.toContain('getActiveAgreementTimestamp');
    expect(publicSiteSource).not.toContain('restoreTransferredAgreement');
    expect(publicSiteSource).not.toContain('mixgold_agreement');
    expect(publicSiteSource).not.toContain('agreedToTerms');
    expect(sePlatformSource).not.toContain('id="agreement-overlay"');
    expect(sePlatformSource).not.toContain('function checkAgreement()');
    expect(sePlatformSource).not.toContain('function acceptAgreement()');
    expect(sePlatformSource).not.toContain('function declineAgreement()');
    expect(sePlatformSource).not.toContain('agreedToTerms');
    expect(publicSiteSource).toContain('if (isMangaReaderActive() || hasSeenSocialBarInVisit()) return;');
  });

  it('لا تنشر عنوان S-E الخاص بالواجهة القديمة', () => {
    expect(publicSiteSource).not.toContain('<title>S-E</title>');
  });
});
