const fs = require('fs');
const path = require('path');
const { findVidmolyLibraryMatch } = require('../lib/vidmolyLibraryMatch');

const snapshot = {
  result: {
    files: [
      {
        file_code: 'onepiece001',
        title: 'One Piece الحلقة 1',
        length: 1440,
        thumb: 'https://images.example/one-piece.jpg',
        download_url: 'https://vidmoly.to/d/onepiece001',
      },
      {
        file_code: 'bleach001',
        title: 'Bleach Episode 1',
        length: 1500,
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

  it('keeps the lookup route free of direct Vidmoly search and file-info calls', () => {
    const route = fs.readFileSync(path.join(__dirname, '../pages/api/doodstream/lookup.js'), 'utf8');
    expect(route).not.toMatch(/searchFiles\s*\(/);
    expect(route).not.toMatch(/fileInfo\s*\(/);
  });
});
