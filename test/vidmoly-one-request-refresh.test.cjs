const { collectOneVidmolyPage } = require('../lib/vidmolyOneRequestRefresh');

describe('single-request Vidmoly refresh', () => {
  it('fetches one provider page only and preserves the provider total', async () => {
    const fetchPage = async (page) => ({
      status: 200,
      result: { total: 58, files: [{ file_code: `page-${page}` }] },
    });
    const calls = [];
    const trackedFetch = async (page) => {
      calls.push(page);
      return fetchPage(page);
    };

    const listed = await collectOneVidmolyPage({
      fetchPage: trackedFetch,
      getFiles: (response) => response.result.files,
    });

    expect(calls).toEqual([1]);
    expect(listed).toMatchObject({ reportedTotal: 58, complete: false, stopped: null });
  });
});
