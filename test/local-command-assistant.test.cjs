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

  it('parses deterministic detailed-information and advanced-sort commands', () => {
    expect(parseLocalCommand('معلومات عن One Piece')).toEqual({ type: 'details', query: 'One Piece' });
    expect(parseLocalCommand('تفاصيل الفيديو Bleach')).toEqual({ type: 'details', query: 'Bleach' });
    expect(parseLocalCommand('اعرض أحدث الفيديوهات')).toEqual({ type: 'advanced-search', filters: { sort: 'newest' } });
    expect(parseLocalCommand('اعرض أكبر الملفات')).toEqual({ type: 'advanced-search', filters: { sort: 'largest' } });
    expect(parseLocalCommand('اعرض الأكثر مشاهدة')).toEqual({ type: 'advanced-search', filters: { sort: 'most-viewed' } });
    expect(parseLocalCommand('ابحث عن One Piece في مجلد Anime')).toEqual({ type: 'search', query: 'One Piece', filters: { folder: 'Anime' } });
  });

  it('recognizes public synopsis requests before they are collected as unknown local commands', () => {
    expect(parseLocalCommand('ملخص العتاولة الحلقة 1')).toEqual({ type: 'external-synopsis', title: 'العتاولة', episode: 1 });
    expect(parseLocalCommand('ملخص قصة مسلسل العتاولة')).toEqual({ type: 'external-synopsis', title: 'العتاولة', episode: null });
    expect(parseLocalCommand('الحلقة 1 من مسلسل العتاولة')).toEqual({ type: 'external-synopsis', title: 'العتاولة', episode: 1 });
    expect(parseLocalCommand('عاوز ملخص الحلقة الأولى من العتاولة من السينما.كوم')).toEqual({ type: 'external-synopsis', title: 'العتاولة', episode: 1 });
    expect(parseLocalCommand('ملخص العتاولة الحلقة الثانية من موقع السينما كوم')).toEqual({ type: 'external-synopsis', title: 'العتاولة', episode: 2 });
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
    expect(source).toContain('getTraining(session.id)');
    expect(source).not.toContain("require('../../../lib/gemini')");
    expect(source).not.toContain('generateContent(');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('vidmoly.');
    expect(source).toContain('findAdvancedLibraryMatches');
    expect(source).toContain('advancedSearch');
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

  it('renders public synopsis answers as a sourced quote rather than generated content', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard', 'ai-chat.js'), 'utf8');
    expect(source).toContain('ai-synopsis-quote');
    expect(source).toContain('ليس ملخصًا مولدًا');
    expect(source).toContain("data.isTruncated ? 'مقتطف حرفي' : 'النص الحرفي'");
    expect(source).toContain('فتح المصدر');
  });

  it('does not retain a runtime Gemini client after the local replacement', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'lib', 'gemini.js'))).toBe(false);
  });

  it('keeps quota status and saved navigation labels free of Gemini configuration', () => {
    const keyManager = fs.readFileSync(path.join(__dirname, '..', 'lib', 'apiKeyManager.js'), 'utf8');
    const settingsApi = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'dashboard-settings.js'), 'utf8');
    expect(keyManager).not.toContain('GEMINI_API_KEY');
    expect(settingsApi).toContain("aiChat: 'منفذ الأوامر المحلي'");
    expect(settingsApi).toContain('LEGACY_AI_CHAT_LABELS');
  });
});
