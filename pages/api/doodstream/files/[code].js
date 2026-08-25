const { requireAuth } = require('../../../../lib/api-auth');
const vidmoly = require('../../../../lib/vidmoly');
const { notifyFileRemoved } = require('../../../../lib/db');
const { markVidmolySnapshotStale } = require('../../../../lib/vidmolyDashboardCache');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const { code, sourceAccountId } = req.query;

  try {
    if (req.method === 'GET') {
      const data = sourceAccountId ? await vidmoly.fileInfoForAccount(sourceAccountId, code) : await vidmoly.fileInfo(code);
      return res.status(200).json(data);
    }

    if (req.method === 'PATCH') {
      const { title, fld_id, sourceAccountId: bodyAccountId } = req.body || {};
      const accountId = bodyAccountId || sourceAccountId;
      if (title) {
        const data = accountId ? await vidmoly.renameFileForAccount(accountId, code, title) : await vidmoly.renameFile(code, title);
        if (data?.status === 200) markVidmolySnapshotStale('library').catch((error) => console.error('Could not mark library snapshot stale:', error.message));
        return res.status(200).json(data);
      }
      if (fld_id !== undefined) {
        const data = accountId ? await vidmoly.moveFileForAccount(accountId, code, fld_id) : await vidmoly.moveFile(code, fld_id);
        if (data?.status === 200) markVidmolySnapshotStale('library').catch((error) => console.error('Could not mark library snapshot stale:', error.message));
        return res.status(200).json(data);
      }
      return res.status(400).json({ error: 'Provide a title or fld_id to update.' });
    }

    if (req.method === 'DELETE') {
      const { sourceAccountId: bodyAccountId } = req.body || {};
      const accountId = bodyAccountId || sourceAccountId;
      const data = accountId ? await vidmoly.deleteFileForAccount(accountId, code) : await vidmoly.deleteFile(code);
      if (data?.status === 200) markVidmolySnapshotStale('library').catch((error) => console.error('Could not mark library snapshot stale:', error.message));
      // Log the notification immediately (with the thumbnail the client
      // still had in memory) instead of waiting for the next library load
      // to notice the file is gone. Never let this block the delete.
      const { title, thumb } = req.body || {};
      notifyFileRemoved({ file_code: code, title, thumb }).catch((err) => {
        console.error('Could not log removal notification:', err.message);
      });
      return res.status(200).json(data);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
