// GET (remoteUploadList) is unused by the frontend — the upload queue is
// tracked client-side and polled per-item via upload-url/[code].js — and
// almost certainly hits a non-existent Vidmoly endpoint (see lib/vidmoly.js:
// the docs' upload category lists only 3 endpoints total, no list/status
// one), so it's left as-is rather than fixed for a code path nothing calls.
const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');
const { cacheFileSize } = require('../../../lib/db');
const { cacheKnownUploadSize } = require('../../../lib/uploadSizeCache');
const { invalidateVidmolySnapshot } = require('../../../lib/vidmolyDashboardCache');

// /upload/url's response shape for the queued file's identifier isn't
// confirmed from the docs (only key/url params were shown, no response
// example) — try every plausible field name before giving up.
function extractFileCode(data) {
  const r = Array.isArray(data.result) ? data.result[0] : data.result;
  return r?.filecode || r?.file_code || r?.code || null;
}

// Vidmoly's API never exposes file size (confirmed — see lib/vidmoly.js
// and library.js's history), so this stops asking Vidmoly for it at all
// and instead reads it straight from the source URL's own Content-Length
// header before handing the URL off. Best-effort: some servers don't
// send it, or block HEAD requests — those just leave size unresolved,
// same as before, rather than failing the upload over it.
async function sourceContentLength(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const len = res.headers.get('content-length');
    return len ? Number(len) : null;
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const data = await vidmoly.remoteUploadList();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { url, fld_id, new_title } = req.body || {};
      if (!url) {
        return res.status(400).json({ error: 'A video URL is required.' });
      }
      const [data, sourceSize] = await Promise.all([
        vidmoly.addRemoteUpload(url, {
          ...(fld_id ? { fld_id } : {}),
          ...(new_title ? { new_title } : {}),
        }),
        sourceContentLength(url),
      ]);
      if (data.status !== 200) return res.status(200).json(data);
      const fileCode = extractFileCode(data);
      if (!fileCode) {
        // Queued successfully but we couldn't find the identifier to
        // poll for progress with — surface the raw response so the real
        // field name can be confirmed instead of guessed a fourth time.
        return res.status(200).json({ ...data, filecode: null, raw: data });
      }
      if (sourceSize !== null) {
        try {
          await cacheKnownUploadSize(cacheFileSize, fileCode, sourceSize);
        } catch (err) {
          console.error('Could not cache source file size:', err.message);
        }
      }
      invalidateVidmolySnapshot('library').catch((error) => console.error('Could not invalidate library snapshot:', error.message));
      return res.status(200).json({ ...data, filecode: fileCode, size: sourceSize });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
