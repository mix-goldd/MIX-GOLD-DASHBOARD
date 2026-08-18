const { collectVidmolyPages, getReportedFileTotal } = require('../lib/vidmolyPagination');

describe('Vidmoly library pagination', () => {
  test('collects every provider page until results_total is reached', async () => {
    const calls = [];
    const pages = {
      1: { status: 200, result: { files: [{ file_code: 'one' }, { file_code: 'two' }], results_total: 3 } },
      2: { status: 200, result: { files: [{ file_code: 'three' }], results_total: 3 } },
    };
    const listing = await collectVidmolyPages({
      fetchPage: async (page) => {
        calls.push(page);
        return pages[page];
      },
      getFiles: (payload) => payload.result.files,
      getFileCode: (file) => file.file_code,
    });

    expect(calls).toEqual([1, 2]);
    expect(listing.complete).toBe(true);
    expect(listing.files.map((file) => file.file_code)).toEqual(['one', 'two', 'three']);
  });

  test('stops before repeated or incomplete pages can create an endless request loop', async () => {
    const listing = await collectVidmolyPages({
      fetchPage: async () => ({ status: 200, result: { files: [{ file_code: 'same' }], results_total: 2 } }),
      getFiles: (payload) => payload.result.files,
      getFileCode: (file) => file.file_code,
    });

    expect(listing.complete).toBe(false);
    expect(listing.stopped).toBe('incomplete-page');
    expect(listing.files).toHaveLength(1);
  });

  test('reads a numeric reported total without exposing response payload contents', () => {
    expect(getReportedFileTotal({ result: { results_total: '27' } })).toBe(27);
    expect(getReportedFileTotal({ result: { results_total: 'not-a-number' } })).toBeNull();
  });
});
