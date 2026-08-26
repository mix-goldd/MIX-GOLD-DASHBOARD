const { calculateTotalVideoSize } = require('./vidmolyStorage');

function selectNextVidmolyAccount(accounts = [], existingPayload = null) {
  if (!Array.isArray(accounts) || !accounts.length) return null;
  const previousIndex = Number(existingPayload?.result?.lastRefreshedAccountIndex);
  const index = Number.isInteger(previousIndex) && previousIndex >= 0
    ? (previousIndex + 1) % accounts.length
    : 0;
  return { account: accounts[index], index };
}

function uniqueByCode(files = []) {
  const byCode = new Map();
  files.forEach((file) => {
    if (file?.file_code) byCode.set(file.file_code, file);
  });
  return Array.from(byCode.values());
}

function mergeIncrementalLibraryResult({ existingResult = null, refreshedResult, account, accountIndex, accountCount }) {
  const previousFiles = Array.isArray(existingResult?.files) ? existingResult.files : [];
  const preserveExistingAccountFiles = Boolean(refreshedResult?.preserveExistingAccountFiles);
  const files = uniqueByCode([
    ...(preserveExistingAccountFiles
      ? previousFiles
      : previousFiles.filter((file) => file.sourceAccountId !== account.id)),
    ...(refreshedResult.files || []),
  ]);
  const previousFolders = Array.isArray(existingResult?.libraryFolders) ? existingResult.libraryFolders : [];
  const libraryFolders = [
    ...(preserveExistingAccountFiles
      ? previousFolders
      : previousFolders.filter((folder) => folder.accountId !== account.id)),
    ...(refreshedResult.libraryFolders || []),
  ];
  const accountTotals = new Map(
    (Array.isArray(existingResult?.accountTotals) ? existingResult.accountTotals : [])
      .map((entry) => [entry.accountId, entry])
  );
  accountTotals.set(account.id, refreshedResult.accountTotal);
  const refreshedAccountIds = Array.from(new Set([
    ...(Array.isArray(existingResult?.refreshedAccountIds) ? existingResult.refreshedAccountIds : []),
    account.id,
  ]));

  const historicallyComplete = Boolean(existingResult?.complete);
  return {
    ...(existingResult || {}),
    files,
    folders: !preserveExistingAccountFiles && (accountIndex === 0 || !Array.isArray(existingResult?.folders))
      ? (refreshedResult.folders || [])
      : existingResult.folders,
    libraryFolders,
    total: files.length,
    totalSize: calculateTotalVideoSize(files),
    accountTotals: Array.from(accountTotals.values()),
    complete: historicallyComplete || (Boolean(refreshedResult.complete) && refreshedAccountIds.length >= accountCount),
    refreshedAccountIds,
    lastRefreshedAccountIndex: accountIndex,
    sourceWarnings: refreshedResult.sourceWarnings || [],
  };
}

module.exports = {
  selectNextVidmolyAccount,
  mergeIncrementalLibraryResult,
};
