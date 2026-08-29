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

  it('يستخدم وسوم الإعلانات الجديدة مع إبقاء Social Bar مرة واحدة لكل زيارة', () => {
    expect(publicSiteSource).toContain('https://pl31016147.profitableratecpmnetwork.com/78/c2/89/78c28961e1078ab06b84ad104f0e6e29.js');
    expect(publicSiteSource).not.toContain('pl30915606.effectivecpmnetwork.com');
    expect(publicSiteSource).toContain('if (isMangaReaderActive() || hasSeenSocialBarInVisit()) return;');
  });

  it('يعرض Native Banner في صف من أربع خانات أفقية بالكود الجديد', () => {
    expect(sePlatformSource).toContain('https://pl31016146.profitableratecpmnetwork.com/da651a3db53f6387213c1823774a77d2/invoke.js');
    expect(sePlatformSource).toContain('container-da651a3db53f6387213c1823774a77d2');
    expect(sePlatformSource).toContain('const AD_UNITS_PER_ROW = 4;');
    expect(sePlatformSource).toContain('class="pixiv-ad-row"');
    expect(sePlatformSource).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(sePlatformSource).not.toContain('YOUR_ADSTERRA_ZONE_KEY_HERE');
    expect(sePlatformSource).not.toContain('www.highperformanceformat.com');
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
    expect(publicSiteSource).toContain('if (isMangaReaderActive() || hasSeenSocialBarInVisit()) return;');
  });

  it('لا تنشر عنوان S-E الخاص بالواجهة القديمة', () => {
    expect(publicSiteSource).not.toContain('<title>S-E</title>');
  });
});
