const fs = require('fs');
const path = require('path');

describe('منشور الحلقة الموحد', () => {
  const project = path.join(__dirname, '..');
  const read = (relativePath) => fs.readFileSync(path.join(project, relativePath), 'utf8');

  it('keeps the playable post and anime episode as one video record', () => {
    const types = read('lib/animeContent.js');
    const createRoute = read('pages/api/content/posts.js');
    const updateRoute = read('pages/api/content/posts/[id].js');

    expect(types).toContain("value: 'video', label: 'منشور / فيديو'");
    expect(types).toContain('export function normalizeContentTypes(raw)');
    expect(types).toContain("label: 'منشور / فيديو'");
    expect(types).toContain("'post', 'episode', 'anime_episode', 'anime-episode'");
    expect(types).toContain("unifiedVideoLabels = new Set(['منشور', 'حلقة أنمي'");
    expect(createRoute).toContain("const type = ALLOWED_TYPES.includes(body.type) ? body.type : 'video';");
    expect(updateRoute).toContain("const type = ALLOWED_TYPES.includes(body.type) ? body.type : 'video';");
    expect(createRoute).not.toContain("type: 'post_episode'");
    expect(updateRoute).not.toContain("type: 'post_episode'");

    const editor = read('pages/dashboard/content.js');
    expect(editor).toContain('contentTypes: normalizeContentTypes(contentTypes)');
    expect(editor).toContain('normalizeContentTypes }');
  });

  it('maps every unified video record once into the public playable collection', () => {
    const publicSite = read('public/site/index.html');

    expect(publicSite).toContain("const videoPosts = postsRows.filter(p => p.type === 'video').map(p => ({");
    expect(publicSite).toContain('if (videoPosts.length) characterData = videoPosts;');
  });
});
