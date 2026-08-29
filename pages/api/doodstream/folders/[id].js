const { requireAuth } = require('../../../../lib/api-auth');
const vidmoly = require('../../../../lib/vidmoly');
const { markVidmolySnapshotStale } = require('../../../../lib/vidmolyDashboardCache');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const { name } = req.body || {};
      if (!name) {
        return res.status(400).json({ error: 'A folder name is required.' });
      }
      const data = await vidmoly.renameFolder(id, name);
      if (data?.status === 200) {
        markVidmolySnapshotStale('library').catch((error) => console.error('Could not mark library snapshot stale:', error.message));
        markVidmolySnapshotStale('folders').catch((error) => console.error('Could not mark folders snapshot stale:', error.message));
      }
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const data = await vidmoly.deleteFolder(id);
      if (data?.status === 200) {
        markVidmolySnapshotStale('library').catch((error) => console.error('Could not mark library snapshot stale:', error.message));
        markVidmolySnapshotStale('folders').catch((error) => console.error('Could not mark folders snapshot stale:', error.message));
      }
      return res.status(200).json(data);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
