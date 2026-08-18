// Vidmoly has no confirmed remote-upload status/progress endpoint (see
// lib/vidmoly.js — the docs' upload category lists only 3 endpoints
// total, none of them a status check), so this doesn't poll a download
// progress percentage at all — that data likely just isn't exposed for
// in-progress remote downloads. Instead it polls /file/info for the
// queued file_code and treats `canplay: 1` as "finished, ready to play"
// (canplay showed up in a real /file/info response captured earlier —
// see the library.js history). Until then, or if the file isn't found
// yet, it reports "downloading" with no fabricated percentage.
const { requireAuth } = require('../../../../lib/api-auth');
const vidmoly = require('../../../../lib/vidmoly');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.query;

  try {
    const data = await vidmoly.fileInfo(code);
    if (data.status !== 200) {
      // Not found yet — Vidmoly is very likely still downloading it and
      // hasn't registered the file_code as a real file. Not an error.
      return res.status(200).json({ status: 200, result: { done: false } });
    }
    const detail = Array.isArray(data.result) ? data.result[0] : data.result;
    res.status(200).json({
      status: 200,
      result: {
        done: !!detail?.canplay,
        length: detail?.file_length ?? null,
        thumb: detail?.player_img ?? null,
        title: detail?.file_title ?? null,
      },
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
