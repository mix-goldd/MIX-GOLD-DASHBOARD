const fs = require('fs');
const path = require('path');

describe('IMGBB_API_KEY', () => {
  it('يعتمد مسار الرفع على السر الخادمي فقط ولا يحتوي مفتاحاً احتياطياً', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'pages/api/media/upload.js'),
      'utf8'
    );

    expect(routeSource).toContain('process.env.IMGBB_API_KEY');
    expect(routeSource).not.toMatch(/IMGBB_API_KEY\s*=\s*process\.env\.IMGBB_API_KEY\s*\|\|/);
    expect(routeSource).not.toContain('9c278ac3013335bd9fbf2d01390496a5');
    expect(routeSource).toContain('خدمة رفع صور الغلاف غير مهيأة حالياً');
  });

  it('يرفع بكسل تحقق صغيراً عبر نقطة ImgBB الرسمية من دون كشف المفتاح', async () => {
    const apiKey = process.env.IMGBB_API_KEY;
    expect(apiKey).toBeTruthy();

    const formData = new FormData();
    formData.append('key', apiKey);
    formData.append(
      'image',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLjpAAAAABJRU5ErkJggg=='
    );
    formData.append('name', `manus-secret-check-${Date.now()}`);

    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json();

    expect(response.ok).toBe(true);
    expect(payload.success).toBe(true);
    expect(payload.data?.url).toMatch(/^https?:\/\//);
  }, 20_000);
});
