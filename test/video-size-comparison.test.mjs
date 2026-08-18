import { describe, expect, it } from 'vitest';
import sizeComparison from '../lib/videoSizeComparison.js';

const {
  parseVideoSizeBytes,
  calculateVideoSizeSummary,
  compareVideoSizeToStorage,
} = sizeComparison;

describe('video size comparison', () => {
  it('parses byte numbers and human-readable sizes', () => {
    expect(parseVideoSizeBytes(1024)).toBe(1024);
    expect(parseVideoSizeBytes('1.5 MB')).toBe(1.5 * 1024 ** 2);
    expect(parseVideoSizeBytes('invalid')).toBeNull();
  });

  it('calculates measured totals and tracks unknown files', () => {
    expect(calculateVideoSizeSummary([
      { size: 1024 },
      { size: '2 MB' },
      { size: null },
    ])).toEqual({
      totalBytes: 1024 + 2 * 1024 ** 2,
      measuredCount: 2,
      unknownCount: 1,
    });
  });

  it('compares calculated file size with provider storage', () => {
    expect(compareVideoSizeToStorage([{ size: '3 MB' }], '2 MB').differenceBytes)
      .toBe(1024 ** 2);
    expect(compareVideoSizeToStorage([{ size: null }], '2 MB').differenceBytes)
      .toBeNull();
  });
});
