const fs = require('fs');
const formidable = require('formidable');
const { requireAuth } = require('../../../lib/api-auth');
const { addMediaItem } = require('../../../lib/siteDb');

// The ImgBB key is supplied only by the server environment. It is never
// embedded in source code or returned to the browser.
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

// We parse the multipart body ourselves (formidable), so Next's default
// JSON body parser must be turned off for this route.
export const config = {
  api: { bodyParser: false },
};

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm({ maxFileSize: 32 * 1024 * 1024 }); // 32MB
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!IMGBB_API_KEY) {
    return res.status(503).json({
      error: 'خدمة رفع صور الغلاف غير مهيأة حالياً. تواصل مع مدير الموقع.',
    });
  }

  let filepath;
  try {
    const { fields, files } = await parseForm(req);
    const uploaded = Array.isArray(files.image) ? files.image[0] : files.image;
    if (!uploaded) {
      return res.status(400).json({ error: 'لم يتم إرفاق أي صورة.' });
    }
    filepath = uploaded.filepath || uploaded.path;
    const name = (Array.isArray(fields.name) ? fields.name[0] : fields.name) || uploaded.originalFilename || 'صورة';

    const fileBuffer = fs.readFileSync(filepath);
    const base64 = fileBuffer.toString('base64');

    const uploadForm = new URLSearchParams();
    uploadForm.append('key', IMGBB_API_KEY);
    uploadForm.append('image', base64);
    uploadForm.append('name', name);

    const imgbbRes = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: uploadForm,
    });
    const imgbbData = await imgbbRes.json();

    if (!imgbbRes.ok || !imgbbData.success) {
      const message = imgbbData?.error?.message || 'فشل رفع الصورة إلى imgbb.';
      return res.status(502).json({ error: message });
    }

    const item = {
      id: imgbbData.data.id,
      url: imgbbData.data.url,
      thumb: imgbbData.data.thumb?.url || imgbbData.data.medium?.url || imgbbData.data.url,
      display_url: imgbbData.data.display_url || imgbbData.data.url,
      delete_url: imgbbData.data.delete_url || null,
      name,
      uploaded_at: new Date().toISOString(),
    };

    try {
      await addMediaItem(item);
    } catch (logErr) {
      // The upload itself succeeded — don't fail the request just because
      // logging it to the media library failed. Just note it server-side.
      console.error('تعذر حفظ العنصر في مكتبة الوسائط:', logErr.message);
    }

    return res.status(200).json({ item });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (filepath) {
      fs.unlink(filepath, () => {});
    }
  }
}
