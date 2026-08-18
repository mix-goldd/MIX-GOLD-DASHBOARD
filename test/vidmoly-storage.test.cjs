const {
  toSizeBytes,
  getVideoSizeBytes,
  calculateTotalVideoSize,
} = require('../lib/vidmolyStorage');

describe('Vidmoly storage capacity', () => {
  test('accepts valid byte values and rejects invalid values', () => {
    expect(toSizeBytes('1048576')).toBe(1048576);
    expect(toSizeBytes(0)).toBe(0);
    expect(toSizeBytes('70.32 MB')).toBeCloseTo(70.32 * 1024 ** 2);
    expect(toSizeBytes('1.5 GB')).toBeCloseTo(1.5 * 1024 ** 3);
    expect(toSizeBytes('')).toBeNull();
    expect(toSizeBytes(-12)).toBeNull();
    expect(toSizeBytes('not-a-size')).toBeNull();
  });

  test('uses a provider size field before the cached size value', () => {
    expect(getVideoSizeBytes({ file_size: '2048' }, { size_bytes: 1024 })).toBe(2048);
    expect(getVideoSizeBytes({}, { size_bytes: '4096' })).toBe(4096);
  });

  test('sums measured video sizes across the unified library', () => {
    expect(calculateTotalVideoSize([
      { size: 1024 },
      { size: '2048' },
      { size: 512 },
    ])).toBe(3584);
  });

  test('sums Vidmoly text sizes from multiple source accounts', () => {
    const bytes = calculateTotalVideoSize([
      { sourceAccountId: 'vidmoly-1', size: '70.32 MB' },
      { sourceAccountId: 'vidmoly-1', size: '166.00 MB' },
      { sourceAccountId: 'vidmoly-1', size: '222.23 MB' },
      { sourceAccountId: 'vidmoly-1', size: '224.56 MB' },
      { sourceAccountId: 'vidmoly-1', size: '204.96 MB' },
      { sourceAccountId: 'vidmoly-1', size: '334.66 MB' },
      { sourceAccountId: 'vidmoly-2', size: '689.77 MB' },
    ]);

    expect(bytes / 1024 ** 2).toBeCloseTo(1912.5);
  });

  test('does not represent unknown sizes as zero storage', () => {
    expect(calculateTotalVideoSize([{ size: null }, {}, { size: 'invalid' }])).toBeNull();
  });
});
