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
const {
  getFileCode,
  accountCacheCode,
  collectAllAccountFiles,
  buildUnifiedVideoFiles,
} = require('../../../lib/unifiedVidmolyLibrary');

async function loadLibraryFromProvider(accounts) {
  const rawRows = [];
    const libraryFolders = [];
    const sourceWarnings = [];
    const accountTotals = [];
    let primaryFolders = [];

    // Sequential on purpose. The Vidmoly client also serializes requests, but
    // this keeps the account-level failure handling clear and non-bursty.
    const accountListings = await collectAllAccountFiles(
      accounts,
      (accountId, opts) => vidmoly.listFilesForAccount(accountId, opts)
    );
    for (const [accountIndex, { account, listed, error }] of accountListings.entries()) {
      if (error) {
        if (error?.code === 'API_QUOTA_WAIT') {
          sourceWarnings.push({
            type: 'quota_wait',
            accountLabel: account.label,
            waitUntil: error.waitUntil || null,
          });
        } else {
          sourceWarnings.push(`${account.label}: ${error.message}`);
        }
        accountTotals.push({ accountId: account.id, label: account.label, returned: 0, total: 0, complete: false });
        continue;
      }

      const files = listed.files;
      if (listed.stopped === 'rate-limited') {
        sourceWarnings.push(`${account.label}: تم بلوغ حد الطلبات أثناء تجميع المكتبة؛ تظهر النتائج المتاحة فقط.`);
      } else if (listed.stopped === 'invalid-response') {
        sourceWarnings.push(`${account.label}: لم تُقرأ قائمة الفيديوهات بصيغة معروفة.`);
      } else if (listed.stopped === 'incomplete-page') {
        sourceWarnings.push(`${account.label}: أعادت Vidmoly صفحة غير مكتملة؛ تظهر ${listed.files.length}${listed.reportedTotal !== null ? ` من ${listed.reportedTotal}` : ''} فيديو.`);
      } else if (listed.stopped === 'page-cap') {
        sourceWarnings.push(`${account.label}: توقف التجميع عند سقف آمن للصفحات لحماية حصة الحساب اليومية.`);
      }
      accountTotals.push({
        accountId: account.id,
        label: account.label,
        returned: files.length,
        total: listed.reportedTotal ?? files.length,
        complete: listed.complete,
      });

      let accountFolders = [];
      try {
        const foldersRes = await vidmoly.listFoldersForAccount(account.id);
        if (Array.isArray(foldersRes.result?.folders)) accountFolders = foldersRes.result.folders;
      } catch (folderError) {
        sourceWarnings.push(`${account.label}: تعذر تحميل أسماء المجلدات.`);
      }

      if (accountIndex === 0) primaryFolders = accountFolders;
      const folderNames = new Map(accountFolders.map((folder) => [String(folder.fld_id), folder.name]));
      accountFolders.forEach((folder) => {
        libraryFolders.push({
          key: `${account.id}:${folder.fld_id}`,
          fld_id: folder.fld_id,
          name: folder.name,
          accountId: account.id,
          label: `${account.label} · ${folder.name}`,
        });
      });

      files.forEach((file) => {
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
    }

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

    const { files, totalSize } = buildUnifiedVideoFiles(rawRows, cache);

    const canSynchronizeKnownFiles =
      accountTotals.length === accounts.length && accountTotals.every((accountTotal) => accountTotal.complete);
    if (canSynchronizeKnownFiles) {
      try {
        await syncKnownFiles(files.map((file) => ({ file_code: file.file_code, title: file.title, thumb: file.thumb })));
      } catch (syncError) {
        console.error('Could not sync known files for notifications:', syncError.message);
      }
    } else {
      sourceWarnings.push('لم تتم مزامنة إشعارات الحذف لأن قائمة فيديوهات أحد الحسابات غير مكتملة بعد.');
    }

  return {
    status: 200,
    result: {
      files,
      folders: primaryFolders,
      libraryFolders,
      total: files.length,
      totalSize,
      accountTotals,
      complete: canSynchronizeKnownFiles,
      sourceWarnings,
    },
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
    const snapshot = await getOrRefreshVidmolySnapshot('library', () => loadLibraryFromProvider(accounts), {
      force,
      shouldPersist: (payload, existingPayload) => {
        const result = payload?.result;
        if (!result) return false;
        // A complete provider pass is authoritative. If there is no saved
        // library yet, retain a non-empty partial pass too; once saved, a
        // quota-limited/partial result must never erase known files or sizes.
        return Boolean(result.complete) || (!existingPayload && Array.isArray(result.files) && result.files.length > 0);
      },
    });
    return res.status(200).json({ ...snapshot.payload, cache: snapshot.meta });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
