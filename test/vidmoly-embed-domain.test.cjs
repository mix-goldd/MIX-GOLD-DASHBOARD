const fs = require('fs');
const path = require('path');
const { buildPlaybackUrl } = require('../lib/vidmolyLibraryMatch');

describe('Vidmoly embed domain', () => {
  it('uses the active Vidmoly player host when a library item supplies only a file code', () => {
    expect(buildPlaybackUrl({ file_code: '5r63seqozp17' })).toBe(
      'https://vidmoly.biz/embed-5r63seqozp17.html'
    );
  });

  it('does not ship any YouTube player or fallback in either visitor HTML surface', () => {
    const publicSite = fs.readFileSync(path.join(__dirname, '../public/site/index.html'), 'utf8');
    const legacySite = fs.readFileSync(path.join(__dirname, '../public/se-platform.html'), 'utf8');
    for (const html of [publicSite, legacySite]) {
      expect(html.toLowerCase()).not.toContain('youtube');
      expect(html.toLowerCase()).not.toContain('youtu.be');
      expect(html).toContain('id="vidmoly-player-iframe"');
      expect(html).toContain('src="about:blank"');
    }
  });
});
