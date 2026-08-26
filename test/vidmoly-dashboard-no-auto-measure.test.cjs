const fs = require('node:fs');
const path = require('node:path');

describe('Vidmoly dashboard reload protection', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'dashboard', 'index.js'),
    'utf8'
  );

  it('never measures every missing file as a side effect of loading the dashboard', () => {
    expect(source).not.toContain('measureMissingSizes');
    expect(source).not.toContain("/api/doodstream/measure-size");
    expect(source).not.toMatch(/files\.filter\(\(file\) => file\.size === null/);
  });

  it('keeps the ordinary load path limited to the cached library and earnings routes', () => {
    expect(source).toContain("fetch('/api/doodstream/library')");
    expect(source).toContain("fetch('/api/doodstream/earnings')");
  });
});

