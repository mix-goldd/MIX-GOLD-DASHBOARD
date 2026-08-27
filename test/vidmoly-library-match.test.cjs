const fs = require('fs');
const path = require('path');
const { findAdvancedLibraryMatches, findVidmolyLibraryMatch } = require('../lib/vidmolyLibraryMatch');

const snapshot = {
  result: {
    files: [
      {
        file_code: 'onepiece001',
        title: 'One Piece الحلقة 1',
        length: 1440,
        thumb: 'https://images.example/one-piece.jpg',
        download_url: 'https://vidmoly.to/d/onepiece001',
        folder: 'Anime',
        size: 734003200,
        views: 4200,
        uploaded: '2026-08-10T10:00:00.000Z',
      },
      {
        file_code: 'bleach001',
        title: 'Bleach Episode 1',
        length: 1500,
        folder: 'Movies',
        size: 1572864000,
        views: 900,
        uploaded: '2026-08-22T10:00:00.000Z',
      },
    ],
  },
};

describe('Vidmoly library title match', () => {
  it('fills the Vidmoly embed URL and duration from the persisted library snapshot', () => {
    expect(findVidmolyLibraryMatch('One Piece الحلقة 1', snapshot)).toEqual({
      title: 'One Piece الحلقة 1',
      file_code: 'onepiece001',
      playback_url: 'https://vidmoly.biz/embed-onepiece001.html',
      download_url: 'https://vidmoly.me/dl/onepiece001',
      thumbnail_url: 'https://images.example/one-piece.jpg',
      duration: 1440,
    });
  });

  it('returns no result when no cached library title matches', () => {
    expect(findVidmolyLibraryMatch('Naruto الحلقة 1', snapshot)).toBeNull();
  });

  it('filters and orders advanced results deterministically from the cached snapshot', () => {
    const filtered = findAdvancedLibraryMatches(snapshot, {
      folder: 'anime',
      minViews: 1000,
      minSizeMb: 500,
      sort: 'most-viewed',
    });

    expect(filtered.filters).toMatchObject({ folder: 'anime', minViews: 1000, minSizeMb: 500, sort: 'most-viewed' });
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]).toMatchObject({
      title: 'One Piece الحلقة 1',
      folder: 'Anime',
      views: 4200,
      size: 734003200,
      playback_url: 'https://vidmoly.biz/embed-onepiece001.html',
      download_url: 'https://vidmoly.me/dl/onepiece001',
    });
  });

  it('sorts cached results by newest and largest without provider calls', () => {
    expect(findAdvancedLibraryMatches(snapshot, { sort: 'newest' }).results[0].title).toBe('Bleach Episode 1');
    expect(findAdvancedLibraryMatches(snapshot, { sort: 'largest' }).results[0].title).toBe('Bleach Episode 1');
  });

  it('keeps the lookup route free of direct Vidmoly search and file-info calls', () => {
    const route = fs.readFileSync(path.join(__dirname, '../pages/api/doodstream/lookup.js'), 'utf8');
    expect(route).not.toMatch(/searchFiles\s*\(/);
    expect(route).not.toMatch(/fileInfo\s*\(/);
  });
});
