const fs = require('node:fs');
const path = require('node:path');
const {
  createLocalDraft,
  helpText,
  parseLocalCommand,
} = require('../lib/localCommandAssistant');

describe('Local command assistant', () => {
  it('parses supported Arabic commands without an AI provider', () => {
    expect(parseLocalCommand('اعرض الفيديوهات')).toEqual({ type: 'list' });
    expect(parseLocalCommand('ابحث عن One Piece')).toEqual({ type: 'search', query: 'One Piece' });
    expect(parseLocalCommand('جهّز نشر الحلقة 1 من One Piece')).toEqual({ type: 'prepare-draft', query: 'الحلقة 1 من One Piece' });
    expect(parseLocalCommand('غيّر عنوان المسودة إلى عنوان جديد')).toEqual({ type: 'rename-draft', title: 'عنوان جديد' });
    expect(parseLocalCommand('احذف المسودة')).toEqual({ type: 'delete-draft' });
  });

  it('returns a help response for unspecified language instead of guessing', () => {
    expect(parseLocalCommand('اكتب وصفًا جميلًا')).toEqual({ type: 'help' });
    expect(helpText()).toContain('ولا أستخدم');
  });

  it('creates a local handoff draft from stored video data only', () => {
    expect(createLocalDraft({
      file_code: 'abc123',
      title: 'حلقة اختبار',
      thumbnail_url: 'https://img.example/cover.jpg',
      playback_url: 'https://vidmoly.me/embed-abc123.html',
      download_url: 'https://vidmoly.me/dl/abc123',
      duration: '24:00',
    })).toEqual({
      type: 'video',
      file_code: 'abc123',
      title: 'حلقة اختبار',
      image: 'https://img.example/cover.jpg',
      url: 'https://vidmoly.me/embed-abc123.html',
      download_url: 'https://vidmoly.me/dl/abc123',
      duration: '24:00',
    });
  });

  it('keeps the command API snapshot-only and provider-free', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'ai', 'chat.js'), 'utf8');
    expect(source).toContain("getDashboardSetting(LIBRARY_SNAPSHOT_KEY)");
    expect(source).not.toContain("require('../../../lib/gemini')");
    expect(source).not.toContain('generateContent(');
    expect(source).not.toContain('fetch(');
  });

  it('removes the metadata-generation call from the content editor', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard', 'content.js'), 'utf8');
    expect(source).not.toContain('/api/ai/generate-metadata');
    expect(source).not.toContain('generateMetadata');
  });

  it('keeps draft edits and deletion behind a local confirmation step', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard', 'ai-chat.js'), 'utf8');
    expect(source).toContain('setPendingChange(data)');
    expect(source).toContain('confirmPendingChange');
    expect(source).toContain("window.sessionStorage.setItem('mix_gold_local_post_draft_v1'");
    expect(source).toContain("window.location.assign('/dashboard/content')");
  });

  it('does not retain a runtime Gemini client after the local replacement', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'lib', 'gemini.js'))).toBe(false);
  });
});
