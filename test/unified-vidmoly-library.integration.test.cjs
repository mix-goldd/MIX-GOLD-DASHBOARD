const {
  collectAllAccountFiles,
  buildUnifiedVideoFiles,
} = require('../lib/unifiedVidmolyLibrary');

describe('Unified Vidmoly library integration', () => {
  test('fetches every configured account and totals their human-readable file sizes', async () => {
    const accounts = [
      { id: 'vidmoly-1', label: 'Vidmoly 1' },
      { id: 'vidmoly-2', label: 'Vidmoly 2' },
    ];
    const calls = [];
    const listings = await collectAllAccountFiles(accounts, async (accountId, { page }) => {
      calls.push(`${accountId}:${page}`);
      const filesByAccount = {
        'vidmoly-1': [
          { file_code: 'a', size: '70.32 MB' },
          { file_code: 'b', size: '166.00 MB' },
          { file_code: 'c', size: '222.23 MB' },
          { file_code: 'd', size: '224.56 MB' },
          { file_code: 'e', size: '204.96 MB' },
          { file_code: 'f', size: '334.66 MB' },
        ],
        'vidmoly-2': [{ file_code: 'g', size: '689.77 MB' }],
      };
      return { status: 200, result: { files: filesByAccount[accountId], results_total: filesByAccount[accountId].length } };
    });

    const rawRows = listings.flatMap(({ account, listed }) => listed.files.map((file) => ({
      account,
      file,
      fileCode: file.file_code,
      folder: null,
    })));
    const { files, totalSize } = buildUnifiedVideoFiles(rawRows);

    expect(calls).toEqual(['vidmoly-1:1', 'vidmoly-2:1']);
    expect(files).toHaveLength(7);
    expect(files.map((file) => file.sourceAccountId)).toEqual([
      'vidmoly-1', 'vidmoly-1', 'vidmoly-1', 'vidmoly-1', 'vidmoly-1', 'vidmoly-1', 'vidmoly-2',
    ]);
    expect(totalSize / 1024 ** 2).toBeCloseTo(1912.5);
  });

  test('uses cached byte sizes for all accounts when Vidmoly list rows omit size fields', () => {
    const accounts = [
      { id: 'vidmoly-1', label: 'Vidmoly 1' },
      { id: 'vidmoly-2', label: 'Vidmoly 2' },
    ];
    const sizeMB = [70.32, 166, 222.23, 224.56, 204.96, 334.66, 689.77];
    const rawRows = sizeMB.map((_, index) => ({
      account: index === 6 ? accounts[1] : accounts[0],
      file: { file_code: `cached-${index + 1}` },
      fileCode: `cached-${index + 1}`,
      folder: null,
    }));
    const cache = new Map(sizeMB.map((value, index) => [
      `cached-${index + 1}`,
      { size_bytes: Math.round(value * 1024 ** 2) },
    ]));

    const { files, totalSize } = buildUnifiedVideoFiles(rawRows, cache);

    expect(files).toHaveLength(7);
    expect(files.every((file) => Number.isFinite(file.size))).toBe(true);
    expect(totalSize / 1024 ** 2).toBeCloseTo(1912.5);
  });
});
