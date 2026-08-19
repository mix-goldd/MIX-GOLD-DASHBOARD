import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getVideoSizeBytes } = require('../lib/vidmolyStorage');

describe('Vidmoly library size fields', () => {
  it('reads content_length from a provider file row', () => {
    expect(getVideoSizeBytes({ content_length: '2 MB' })).toBe(2 * 1024 * 1024);
  });

  it('reads contentLength from a cached file row', () => {
    expect(getVideoSizeBytes({}, { contentLength: 4096 })).toBe(4096);
  });
});
