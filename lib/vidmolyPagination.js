const MAX_LIBRARY_PAGES_PER_ACCOUNT = 45;

function getReportedFileTotal(filesRes) {
  const result = filesRes?.result;
  const candidate = result?.results_total ?? result?.total ?? result?.results;
  const total = Number(candidate);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

async function collectVidmolyPages({ fetchPage, getFiles, getFileCode, maxPages = MAX_LIBRARY_PAGES_PER_ACCOUNT }) {
  const uniqueFiles = new Map();
  let reportedTotal = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(page);
    if (response?.status === 429) {
      return { files: [...uniqueFiles.values()], reportedTotal, complete: false, stopped: 'rate-limited' };
    }

    const files = response?.status === 200 ? getFiles(response) : null;
    if (!files) {
      return { files: [...uniqueFiles.values()], reportedTotal, complete: false, stopped: 'invalid-response' };
    }

    const pageTotal = getReportedFileTotal(response);
    if (pageTotal !== null) reportedTotal = pageTotal;

    let addedOnPage = 0;
    for (const file of files) {
      const fileCode = getFileCode(file);
      if (fileCode && !uniqueFiles.has(fileCode)) {
        uniqueFiles.set(fileCode, file);
        addedOnPage += 1;
      }
    }

    if ((reportedTotal !== null && uniqueFiles.size >= reportedTotal) || (files.length === 0 && reportedTotal === null)) {
      return { files: [...uniqueFiles.values()], reportedTotal, complete: true, stopped: null };
    }
    if (!files.length || !addedOnPage) {
      return { files: [...uniqueFiles.values()], reportedTotal, complete: false, stopped: 'incomplete-page' };
    }
  }

  return { files: [...uniqueFiles.values()], reportedTotal, complete: false, stopped: 'page-cap' };
}

module.exports = { MAX_LIBRARY_PAGES_PER_ACCOUNT, getReportedFileTotal, collectVidmolyPages };
