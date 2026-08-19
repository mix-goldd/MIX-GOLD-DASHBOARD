const fs = require('fs');
const formidable = require('formidable');
const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');
const { getNextApiKey, recordApiOutcome } = require('../../../lib/apiKeyManager');
const { cacheFileSize } = require('../../../lib/db');
const { cacheKnownUploadSize } = require('../../../lib/uploadSizeCache');
const { invalidateVidmolySnapshot } = require('../../../lib/vidmolyDashboardCache');

// We parse the multipart body ourselves (formidable), so Next's
// default JSON body parser must be turned off for this route.
export const config = {
  api: { bodyParser: false },
};

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm({ maxFileSize: 4 * 1024 * 1024 * 1024 }); // 4GB
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

  let filepath;
  try {
    const { fields, files } = await parseForm(req);
    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploaded) {
      return res.status(400).json({ error: 'No file was attached.' });
    }
    filepath = uploaded.filepath || uploaded.path;
    const originalName = uploaded.originalFilename || uploaded.name || 'upload.mp4';
    // formidable already knows the exact byte count from the multipart
    // stream itself — no need to ask Vidmoly (which doesn't expose this
    // at all, confirmed — see library.js's history).
    const originalSize = uploaded.size || null;
    const fldIdRaw = Array.isArray(fields.fld_id) ? fields.fld_id[0] : fields.fld_id;
    const fldId = fldIdRaw ? String(fldIdRaw) : '';

    // Step 1: reserve one eligible account and ask Vidmoly for its upload server.
    // The same account is used for the multipart upload, so a rotated key is
    // never followed by a hard-coded primary key.
    const uploadCredential = await getNextApiKey('vidmoly');
    const serverRes = await vidmoly.getUploadServerForAccount(uploadCredential.id);
    if (serverRes.status !== 200 || !serverRes.result) {
      return res.status(502).json({ error: 'Vidmoly did not return an upload server.' });
    }

    // Step 2: forward the file to that server ourselves, so the
    // API key is attached here on the backend, never in the browser.
    const apiKey = uploadCredential.value;
    const uploadForm = new FormData();
    uploadForm.append('api_key', apiKey);
    if (fldId) uploadForm.append('fld_id', fldId);
    const fileBuffer = fs.readFileSync(filepath);
    uploadForm.append('file', new Blob([fileBuffer]), originalName);

    const uploadRes = await fetch(`${serverRes.result}?${apiKey}`, {
      method: 'POST',
      body: uploadForm,
    });
    const uploadData = await uploadRes.json();
    await recordApiOutcome({
      provider: 'vidmoly',
      keyId: uploadCredential.id,
      httpStatus: uploadRes.status,
      providerPayload: uploadData,
    });

    // Fallback: some upload servers ignore fld_id on the multipart
    // upload itself, so explicitly move the file afterward too.
    if (uploadData.status === 200 && uploadData.result) {
      const uploadedItem = Array.isArray(uploadData.result) ? uploadData.result[0] : uploadData.result;
      const fileCode = uploadedItem?.filecode || uploadedItem?.file_code;
      if (fileCode && fldId) {
        try {
          await vidmoly.moveFileForAccount(uploadCredential.id, fileCode, fldId);
        } catch (moveErr) {
          // Upload already succeeded — surface a warning but don't fail the request.
          uploadData.folder_move_warning = 'Uploaded, but moving it to the selected folder failed.';
        }
      }
      if (fileCode && originalSize !== null) {
        try {
          await cacheKnownUploadSize(cacheFileSize, fileCode, originalSize);
        } catch (err) {
          console.error('Could not cache uploaded file size:', err.message);
        }
      }
      invalidateVidmolySnapshot('library').catch((error) => console.error('Could not invalidate library snapshot:', error.message));
    }

    res.status(200).json(uploadData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (filepath) {
      fs.unlink(filepath, () => {});
    }
  }
}
