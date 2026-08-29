const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');
const { getOrRefreshVidmolySnapshot, markVidmolySnapshotStale } = require('../../../lib/vidmolyDashboardCache');

// Walks every folder in the account (folders only — no file listing,
// so this stays cheap even for large libraries). Used to populate
// folder-picker dropdowns (upload forms, move-to-folder).
async function collectFoldersRecursive(fldId, depth = 0) {
  if (depth > 6) return [];
  const listing = await vidmoly.listFolder(fldId, true);
  if (listing.status !== 200 || !listing.result) return [];
  const subfolders = listing.result.folders || [];
  const nested = await Promise.all(
    subfolders.map((f) => collectFoldersRecursive(f.fld_id, depth + 1))
  );
  return [...subfolders.map((f) => ({ fld_id: f.fld_id, name: f.name })), ...nested.flat()];
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'POST') {
      const { name, parent_id } = req.body || {};
      if (!name) {
        return res.status(400).json({ error: 'A folder name is required.' });
      }
      const data = await vidmoly.createFolder(name, parent_id);
      if (data?.status === 200) {
        markVidmolySnapshotStale('library').catch((error) => console.error('Could not mark library snapshot stale:', error.message));
        markVidmolySnapshotStale('folders').catch((error) => console.error('Could not mark folders snapshot stale:', error.message));
      }
      return res.status(200).json(data);
    }

    if (req.query.all === '1') {
      // Cached the same way the library list is: the full folder tree is
      // only needed to fill picker dropdowns, so re-opening the upload page
      // reuses the last snapshot instead of spending a live Vidmoly request
      // every time. Callers always walk from the root, so one shared
      // snapshot per deployment is correct here.
      const force = req.query.refresh === '1' && session.role === 'admin';
      const snapshot = await getOrRefreshVidmolySnapshot(
        'folders',
        () => collectFoldersRecursive(req.query.fld_id || 0).then((folders) => ({ status: 200, result: { folders } })),
        { force }
      );
      return res.status(200).json(snapshot.payload);
    }

    const { fld_id } = req.query;
    const data = await vidmoly.listFolder(fld_id || 0);
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
