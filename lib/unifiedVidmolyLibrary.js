const { collectVidmolyPages } = require('./vidmolyPagination');
const { getVideoSizeBytes, calculateTotalVideoSize } = require('./vidmolyStorage');

function extractFileArray(filesRes) {
  if (Array.isArray(filesRes?.result)) return filesRes.result;
  if (Array.isArray(filesRes?.result?.files)) return filesRes.result.files;
  if (Array.isArray(filesRes?.result?.list)) return filesRes.result.list;
  if (Array.isArray(filesRes?.result?.data)) return filesRes.result.data;
  return null;
}

function getFileCode(file) {
  return file?.file_code || file?.filecode || file?.code || null;
}

function accountCacheCode(accountId, fileCode) {
  return `${accountId}:${fileCode}`;
}

async function collectAllAccountFiles(accounts, listFilesForAccount) {
  const listings = [];
  for (const account of accounts) {
    try {
      const listed = await collectVidmolyPages({
        fetchPage: (page) => listFilesForAccount(account.id, { page }),
        getFiles: extractFileArray,
        getFileCode,
      });
      listings.push({ account, listed, error: null });
    } catch (error) {
      listings.push({ account, listed: null, error });
    }
  }
  return listings;
}

function buildUnifiedVideoFiles(rawRows, cache = new Map()) {
  // File codes are provider identifiers. A repeated file code means the same
  // asset was listed more than once and must not inflate the storage total.
  const uniqueRows = Array.from(
    rawRows.reduce((rowsByCode, row) => {
      if (!rowsByCode.has(row.fileCode)) rowsByCode.set(row.fileCode, row);
      return rowsByCode;
    }, new Map()).values()
  );

  const files = uniqueRows.map((row) => {
    const cached = cache.get(accountCacheCode(row.account.id, row.fileCode)) || cache.get(row.fileCode);
    return {
      file_code: row.fileCode,
      row_id: accountCacheCode(row.account.id, row.fileCode),
      sourceAccountId: row.account.id,
      sourceAccountLabel: row.account.label,
      title: row.file.title ?? cached?.title ?? 'Untitled video',
      length: cached?.length_seconds ?? row.file.length ?? null,
      views: cached?.views ?? row.file.views ?? null,
      uploaded: row.file.uploaded ?? cached?.uploaded_date ?? null,
      size: getVideoSizeBytes(row.file, cached),
      thumb: cached?.thumb ?? row.file.single_img ?? null,
      folder: row.folder,
      download_url: row.file.download_url ?? cached?.download_url ?? null,
    };
  });

  return { files, totalSize: calculateTotalVideoSize(files) };
}

module.exports = {
  extractFileArray,
  getFileCode,
  accountCacheCode,
  collectAllAccountFiles,
  buildUnifiedVideoFiles,
};
