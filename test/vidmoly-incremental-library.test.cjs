const {
  selectNextVidmolyAccount,
  mergeIncrementalLibraryResult,
} = require('../lib/vidmolyIncrementalLibrary');

describe('incremental Vidmoly library refresh', () => {
  const accounts = [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three' }];

  it('selects exactly one account and rotates to the next account on the next refresh', () => {
    expect(selectNextVidmolyAccount(accounts, null)).toEqual({ account: accounts[0], index: 0 });
    expect(selectNextVidmolyAccount(accounts, { result: { lastRefreshedAccountIndex: 0 } })).toEqual({ account: accounts[1], index: 1 });
    expect(selectNextVidmolyAccount(accounts, { result: { lastRefreshedAccountIndex: 2 } })).toEqual({ account: accounts[0], index: 0 });
  });

  it('replaces only the refreshed account files and keeps the remaining cached library', () => {
    const existingResult = {
      files: [
        { file_code: 'old-one', sourceAccountId: 'one', size: 10 },
        { file_code: 'keep-two', sourceAccountId: 'two', size: 20 },
      ],
      folders: [{ name: 'Old primary' }],
      libraryFolders: [{ accountId: 'one', name: 'Old One' }, { accountId: 'two', name: 'Keep Two' }],
      accountTotals: [{ accountId: 'one', total: 1 }, { accountId: 'two', total: 1 }],
      refreshedAccountIds: ['one', 'two'],
    };
    const result = mergeIncrementalLibraryResult({
      existingResult,
      refreshedResult: {
        files: [{ file_code: 'new-one', sourceAccountId: 'one', size: 30 }],
        folders: [{ name: 'New primary' }],
        libraryFolders: [{ accountId: 'one', name: 'New One' }],
        accountTotal: { accountId: 'one', total: 1, complete: true },
      },
      account: accounts[0],
      accountIndex: 0,
      accountCount: accounts.length,
    });

    expect(result.files.map((file) => file.file_code).sort()).toEqual(['keep-two', 'new-one']);
    expect(result.totalSize).toBe(50);
    expect(result.libraryFolders.map((folder) => folder.name).sort()).toEqual(['Keep Two', 'New One']);
    expect(result.complete).toBe(false);
  });
});
