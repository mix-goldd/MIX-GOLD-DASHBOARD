const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_RESPONSE_BYTES,
  MAX_SYNOPSIS_LENGTH,
  SynopsisLookupError,
  cleanText,
  excerptSynopsis,
  extractEpisodeSynopsis,
  extractWorkSearchResult,
  extractWorkSynopsis,
  fetchAllowedHtml,
  isAllowedSourceUrl,
  lookupElcinemaSynopsis,
  validateSynopsisRequest,
} = require('../lib/elcinemaSynopsis');

const SEARCH_HTML = `
  <main>
    <a href="/person/1/">اسم شخص</a>
    <a href="/work/2082898/">مسلسل العتاولة</a>
  </main>`;
const EPISODES_HTML = `
  <h1>مسلسل العتاولة</h1>
  <article><h2>حلقة #1</h2><p>يُجهز <b>خضر</b> ونصار لحفل زفاف شقيقتهما، ويُكلف خضر بمهمة.</p><a href="/work/2082898/episodes/7139399">المزيد</a></article>
  <article><h2>حلقة #2</h2><p>هذا ملخص الحلقة الثانية فقط.</p></article>`;
const LIVE_EPISODE_SHAPE = `
  <a href="#episode_11">حلقة #1</a>
  <div><ul id="episode_11"><li>الجزء 1</li><li>حلقة #1</li></ul></div>
  <div><p>الملخص الفعلي للحلقة الأولى فقط.</p></div><a href="/work/2082898/episodes/7139399">المزيد</a>
  <div><ul id="episode_12"><li>حلقة #2</li></ul><p>ملخص ثانٍ.</p></div>`;
const WORK_HTML = '<h1>مسلسل العتاولة</h1><section><h2>ملخص القصة</h2><p>تدور الأحداث حول شقيقين يدخلان في صراع عائلي.</p></section>';

function htmlResponse(html, url = 'https://elcinema.com/work/2082898/') {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => html,
  };
}

describe('Elcinema synopsis parser', () => {
  it('extracts the matched work from a public search page', () => {
    expect(extractWorkSearchResult(SEARCH_HTML, 'العتاولة')).toEqual({ workId: '2082898', title: 'مسلسل العتاولة' });
  });

  it('extracts episode one, keeps a short clean excerpt, and returns the detail source link', () => {
    expect(extractEpisodeSynopsis(EPISODES_HTML, 1, '2082898')).toEqual({
      synopsis: 'يُجهز خضر ونصار لحفل زفاف شقيقتهما، ويُكلف خضر بمهمة.',
      sourceUrl: 'https://elcinema.com/work/2082898/episodes/7139399',
    });
  });

  it('returns no episode result for an unavailable episode and does not fall back to another episode', () => {
    expect(extractEpisodeSynopsis(EPISODES_HTML, 3, '2082898')).toBeNull();
  });

  it('ignores the episode navigation link and reads the matching detailed episode block', () => {
    expect(extractEpisodeSynopsis(LIVE_EPISODE_SHAPE, 1, '2082898')).toMatchObject({
      synopsis: 'الملخص الفعلي للحلقة الأولى فقط.',
      sourceUrl: 'https://elcinema.com/work/2082898/episodes/7139399',
    });
  });

  it('extracts a general work synopsis only from its labelled story section', () => {
    expect(extractWorkSynopsis(WORK_HTML)).toBe('تدور الأحداث حول شقيقين يدخلان في صراع عائلي.');
    expect(extractWorkSynopsis('<h1>عمل بلا ملخص</h1><p>نص غير مصنف</p>')).toBe('');
  });

  it('cleans markup and caps the displayed text without retaining a long response', () => {
    expect(cleanText('<p>نص&nbsp;<b>منظف</b><script>ignore()</script></p>')).toBe('نص منظف');
    const longText = 'أ'.repeat(MAX_SYNOPSIS_LENGTH + 50);
    expect(excerptSynopsis(longText)).toHaveLength(MAX_SYNOPSIS_LENGTH);
    expect(excerptSynopsis(longText)).toMatch(/…$/);
  });

  it('allows only the public HTTPS source host and constrains the request shape', () => {
    expect(isAllowedSourceUrl('https://elcinema.com/work/2082898/')).toBe(true);
    expect(isAllowedSourceUrl('https://www.elcinema.com/work/2082898/')).toBe(true);
    expect(isAllowedSourceUrl('http://elcinema.com/work/2082898/')).toBe(false);
    expect(isAllowedSourceUrl('https://elcinema.com.evil.example/work/2082898/')).toBe(false);
    expect(validateSynopsisRequest({ title: 'العتاولة', episode: '1' })).toEqual({ title: 'العتاولة', episode: 1 });
    expect(() => validateSynopsisRequest({ title: 'العتاولة', episode: '0' })).toThrow(SynopsisLookupError);
  });

  it('rejects a redirected host or oversized source response before parsing content', async () => {
    await expect(fetchAllowedHtml('https://elcinema.com/search/?q=test', async () => htmlResponse('<p>test</p>', 'https://example.com/'))).rejects.toMatchObject({ code: 'SOURCE_INVALID_URL' });
    await expect(fetchAllowedHtml('https://elcinema.com/search/?q=test', async () => ({
      ...htmlResponse('<p>test</p>', 'https://elcinema.com/search/?q=test'),
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html' : String(MAX_RESPONSE_BYTES + 1)) },
    }))).rejects.toMatchObject({ code: 'SOURCE_RESPONSE_TOO_LARGE' });
  });

  it('looks up an episode with two bounded public page reads and marks whether the displayed source text was trimmed', async () => {
    const calls = [];
    const result = await lookupElcinemaSynopsis({ title: 'العتاولة', episode: 1 }, {
      fetchImpl: async (url) => {
        calls.push(url);
        return url.includes('/search/')
          ? htmlResponse(SEARCH_HTML, url)
          : htmlResponse(EPISODES_HTML, url);
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('https://elcinema.com/search/?q=');
    expect(calls[1]).toBe('https://elcinema.com/work/2082898/episodes');
    expect(result).toMatchObject({
      title: 'مسلسل العتاولة',
      episode: 1,
      isTruncated: false,
      sourceName: 'السينما.كوم',
      sourceUrl: 'https://elcinema.com/work/2082898/episodes/7139399',
    });
    expect(result.synopsis).toContain('خضر');
    expect(result.synopsis.length).toBeLessThanOrEqual(MAX_SYNOPSIS_LENGTH);
    expect(Object.keys(result).sort()).toEqual(['episode', 'fetchedAt', 'isTruncated', 'sourceName', 'sourceUrl', 'synopsis', 'title']);
  });
});

describe('Elcinema external route isolation', () => {
  it('keeps local commands snapshot-only while isolating synopsis fetching to explicit publish handling', () => {
    const chatSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'ai', 'chat.js'), 'utf8');
    const routeSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'ai', 'external-synopsis.js'), 'utf8');
    const parserSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'elcinemaSynopsis.js'), 'utf8');
    expect(chatSource).toContain('synopsisRequest');
    expect(chatSource).not.toContain('fetch(');
    expect(chatSource).toContain('lookupElcinemaSynopsis');
    expect(chatSource).toContain('findDescriptionForDraft');
    expect(routeSource).toContain('requireAuth(req, res)');
    expect(routeSource).toContain("req.method !== 'POST'");
    expect(routeSource).toContain('lookupElcinemaSynopsis(request)');
    expect(parserSource).toContain('ALLOWED_HOSTS');
    expect(parserSource).toContain('AbortController');
    expect(parserSource).toContain('MAX_RESPONSE_BYTES');
    expect(parserSource).toContain("Accept: 'text/html'");
  });
});
