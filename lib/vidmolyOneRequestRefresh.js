const { getReportedFileTotal } = require('./vidmolyPagination');

async function collectOneVidmolyPage({ fetchPage, getFiles, page = 1 }) {
  const response = await fetchPage(page);
  if (response?.status === 429) {
    return { files: [], reportedTotal: null, complete: false, stopped: 'rate-limited' };
  }

  const files = response?.status === 200 ? getFiles(response) : null;
  if (!files) {
    return { files: [], reportedTotal: null, complete: false, stopped: 'invalid-response' };
  }

  const reportedTotal = getReportedFileTotal(response);
  return {
    files,
    reportedTotal,
    complete: reportedTotal === null ? files.length === 0 : files.length >= reportedTotal,
    stopped: null,
  };
}

module.exports = { collectOneVidmolyPage };
