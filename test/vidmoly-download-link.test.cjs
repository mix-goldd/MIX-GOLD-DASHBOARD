const { findVidmolyLibraryMatch } = require('../lib/vidmolyLibraryMatch');

describe('Vidmoly playback and download links', () => {
  it('keeps the provider download URL separate from the generated embed URL', () => {
    const result = findVidmolyLibraryMatch('One Piece 1', {
      files: [
        {
          title: 'One Piece 1',
          file_code: '5r63seqozp17',
          embed_url: 'https://vidmoly.to/embed-5r63seqozp17.html',
          download_url: 'https://vidmoly.to/d/5r63seqozp17',
        },
      ],
    });

    expect(result.playback_url).toBe('https://vidmoly.biz/embed-5r63seqozp17.html');
    expect(result.download_url).toBe('https://vidmoly.me/dl/5r63seqozp17');
    expect(result.playback_url).not.toBe(result.download_url);
  });

  it('builds the standard download URL from the file code when Vidmoly omits a download URL', () => {
    const result = findVidmolyLibraryMatch('One Piece 2', {
      files: [
        {
          title: 'One Piece 2',
          file_code: 'abc123',
          embed_url: 'https://vidmoly.to/embed-abc123.html',
        },
      ],
    });

    expect(result.playback_url).toBe('https://vidmoly.biz/embed-abc123.html');
    expect(result.download_url).toBe('https://vidmoly.me/dl/abc123');
  });

  it('builds the standard download URL from an embed URL when only the URL is available', () => {
    const result = findVidmolyLibraryMatch('One Piece 3', {
      files: [
        {
          title: 'One Piece 3',
          embed_url: 'https://vidmoly.biz/embed-xyz789.html',
        },
      ],
    });

    expect(result.download_url).toBe('https://vidmoly.me/dl/xyz789');
  });
});
