// Unified Vidmoly library. Every configured account is queried once for its
// inexpensive file list, then all unique files are returned as one table.
// File-detail calls are intentionally served from cache only: fetching details
// for every row would consume the daily request budget just by opening this
// page.
const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');
const { getConfiguredApiKeyDefinitions } = require('../../../lib/apiKeyManager');
const { syncKnownFiles, getCachedFileDetails } = require('../../../lib/db');
const { getOrRefreshVidmolySnapshot } = require('../../../lib/vidmolyDashboardCache');
const { selectNextVidmolyAccount, mergeIncrementalLibraryResult } = require('../../../lib/vidmolyIncrementalLibrary');
const { collectOneVidmolyPage } = require('../../../lib/vidmolyOneRequestRefresh');
const {
  getFileCode,
  accountCacheCode,
  extractFileArray,
  buildUnifiedVideoFiles,
} = require('../../../lib/unifiedVidmolyLibrary');

async function loadLibraryFromProvider(accounts, existingPayload = null) {
  const selected = selectNextVidmolyAccount(accounts, existingPayload);
  if (!selected) throw new Error('لا يوجد حساب Vidmoly متاح للتحديث.');
  const { account, index: accountIndex } = selected;
  const rawRows = [];
  const libraryFolders = [];
  const sourceWarnings = [];
  let primaryFolders = [];
  let accountTotal = null;

    // A dashboard refresh must make exactly one provider request. Fresh data
    // is merged into the durable snapshot; folders and other accounts stay
    // cached so reloading this page never spends the whole daily allocation.
    const listed = await collectOneVidmolyPage({
      fetchPage: (page) => vidmoly.listFilesForAccount(account.id, { page }),
      getFiles: extractFileArray,
    });
    const fetchedFiles = listed.files;
      if (listed.stopped === 'rate-limited') {
        sourceWarnings.push(`${account.label}: تم بلوغ حد الطلبات أثناء تجميع المكتبة؛ تظهر النتائج المتاحة فقط.`);
      } else if (listed.stopped === 'invalid-response') {
        sourceWarnings.push(`${account.label}: لم تُقرأ قائمة الفيديوهات بصيغة معروفة.`);
      } else if (listed.stopped === 'incomplete-page') {
        sourceWarnings.push(`${account.label}: أعادت Vidmoly صفحة غير مكتملة؛ تظهر ${listed.files.length}${listed.reportedTotal !== null ? ` من ${listed.reportedTotal}` : ''} فيديو.`);
      } else if (listed.stopped === 'page-cap') {
        sourceWarnings.push(`${account.label}: توقف التجميع عند سقف آمن للصفحات لحماية حصة الحساب اليومية.`);
      }
      accountTotal = {
        accountId: account.id,
        label: account.label,
        returned: fetchedFiles.length,
        total: listed.reportedTotal ?? fetchedFiles.length,
        complete: listed.complete,
      };

    const knownFolders = Array.isArray(existingPayload?.result?.libraryFolders)
      ? existingPayload.result.libraryFolders.filter((folder) => folder.accountId === account.id)
      : [];
    primaryFolders = Array.isArray(existingPayload?.result?.folders) ? existingPayload.result.folders : [];
    const folderNames = new Map(knownFolders.map((folder) => [String(folder.fld_id), folder.name]));
    fetchedFiles.forEach((file) => {
      const fileCode = getFileCode(file);
      if (!fileCode) return;
      const fldId = file.fld_id ?? null;
      rawRows.push({
        file,
        fileCode,
        account,
        folder: fldId === null ? null : {
          fld_id: fldId,
          name: folderNames.get(String(fldId)) || '—',
          key: `${account.id}:${fldId}`,
        },
      });
    });

    const cacheCodes = rawRows.flatMap((row) => [
      accountCacheCode(row.account.id, row.fileCode),
      row.fileCode,
    ]);
    let cache = new Map();
    try {
      cache = await getCachedFileDetails(cacheCodes);
    } catch (error) {
      sourceWarnings.push('تعذر قراءة ذاكرة تفاصيل الفيديوهات المؤقتة.');
    }

    const { files: unifiedFiles } = buildUnifiedVideoFiles(rawRows, cache);
    const result = mergeIncrementalLibraryResult({
      existingResult: existingPayload?.result || null,
      refreshedResult: {
        files: unifiedFiles,
        folders: primaryFolders,
        libraryFolders,
        accountTotal,
        sourceWarnings,
        complete: listed.complete,
        preserveExistingAccountFiles: true,
      },
      account,
      accountIndex,
      accountCount: accounts.length,
    });
    if (result.complete) {
      try {
        await syncKnownFiles(result.files.map((file) => ({ file_code: file.file_code, title: file.title, thumb: file.thumb })));
      } catch (syncError) {
        console.error('Could not sync known files for notifications:', syncError.message);
      }
    }

  return {
    status: 200,
    result,
  };
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const accounts = getConfiguredApiKeyDefinitions('vidmoly');
  if (!accounts.length) {
    return res.status(503).json({ error: 'لا يوجد حساب Vidmoly مضاف على الخادم.' });
  }

  try {
    const force = req.query.refresh === '1' && session.role === 'admin';
    const snapshot = await getOrRefreshVidmolySnapshot('library', (existingPayload) => loadLibraryFromProvider(accounts, existingPayload), {
      force,
      shouldPersist: (payload, existingPayload) => {
        const result = payload?.result;
        if (!result) return false;
        // The loader merges its one-page result with the durable snapshot, so
        // every non-empty merged payload is safe to cache for the full TTL.
        // This is what prevents a page reload from triggering another request.
        return Array.isArray(result.files) && result.files.length > 0;
      },
    });
    return res.status(200).json({ ...snapshot.payload, cache: snapshot.meta });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
