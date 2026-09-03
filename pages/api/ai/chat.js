// Deterministic local command executor. Search, drafting, and publishing
// deliberately read only the durable Vidmoly library snapshot and never ask
// Vidmoly for fresh data — the one exception is "حمل وانشر", which by
// definition has to talk to Vidmoly to start and check an upload.
const { requireAuth } = require('../../../lib/api-auth');
const { getDashboardSetting } = require('../../../lib/db');
const { collectLibraryFiles, findAdvancedLibraryMatches, findVidmolyLibraryMatch, getLibraryItemDetails, matchTitlesBySize } = require('../../../lib/vidmolyLibraryMatch');
const { createLocalDraft, guessEpisodeFromTitle, guessSeriesFromTitle, helpText, isUnrecognizedLocalCommand, parseLocalCommand } = require('../../../lib/localCommandAssistant');
const { getTraining, recordUnrecognizedPhrase } = require('../../../lib/localCommandTraining');
const { listPosts, createPost } = require('../../../lib/siteDb');
const { lookupElcinemaSynopsis } = require('../../../lib/elcinemaSynopsis');
const vidmoly = require('../../../lib/vidmoly');
const { markVidmolySnapshotStale } = require('../../../lib/vidmolyDashboardCache');

function normalizeSeriesText(value) {
  return String(value || '').trim().toLowerCase();
}

const LIBRARY_SNAPSHOT_KEY = 'vidmoly_library_snapshot_v1';
// Each rename is a real /file/rename call — capped well under the daily
// quota, same reasoning as MAX_BATCH for uploads, so one size-match command
// can never eat the whole day's budget by itself.
const MAX_RENAME_BATCH = 20;

function publicFile(item) {
  return getLibraryItemDetails(item);
}

function getAdvancedSearchInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    query: typeof value.query === 'string' ? value.query : '',
    folder: typeof value.folder === 'string' ? value.folder : '',
    sort: typeof value.sort === 'string' ? value.sort : 'relevance',
    minViews: value.minViews,
    minSizeMb: value.minSizeMb,
  };
}

// Best-effort real synopsis for the description field. elcinema.com only
// covers Arabic film/TV, not anime — a miss here is expected for a lot of
// titles and never blocks the publish itself, it just leaves description
// blank exactly like a manual publish where the field was skipped.
async function findDescriptionForDraft(draft) {
  const seriesGuess = guessSeriesFromTitle(draft.title);
  if (!seriesGuess) return null;
  try {
    const episode = guessEpisodeFromTitle(draft.title);
    const synopsis = await lookupElcinemaSynopsis({ title: seriesGuess, episode: episode || undefined });
    return synopsis?.synopsis || null;
  } catch (error) {
    return null;
  }
}

async function publishDraftToSite(draft) {
  const seriesGuess = guessSeriesFromTitle(draft.title);
  let series = seriesGuess || undefined;
  if (seriesGuess) {
    try {
      const existingPosts = await listPosts();
      const existingMatch = existingPosts.find((post) => normalizeSeriesText(post.series) === normalizeSeriesText(seriesGuess));
      if (existingMatch) series = existingMatch.series;
    } catch (error) {
      // Falls back to the guessed series text as-is if the existing-posts
      // lookup fails — never blocks the publish itself over this.
    }
  }
  // Mirrors the exact row shape pages/api/content/posts.js builds for a
  // manual video publish, so a chat-published post is indistinguishable
  // from one saved through the form (same null-vs-empty-array choices) —
  // description is the one field manual publishes leave blank that this
  // fills in automatically, best-effort, from a real published source.
  const description = await findDescriptionForDraft(draft);
  return createPost({
    type: 'video',
    title: draft.title,
    thumbnail_url: draft.image,
    page_url: draft.url || null,
    download_url: draft.download_url || draft.url || null,
    category: null,
    categories: [],
    studio: null,
    series: series || null,
    duration: draft.duration || null,
    model_id: null,
    description,
    images: null,
    views: 0,
  });
}

function snapshotUnavailable() {
  return {
    text: 'لا توجد نسخة محلية من مكتبة Vidmoly الآن. افتح صفحة الفيديوهات لاحقًا لتظهر آخر البيانات المخزنة؛ لن أرسل طلبًا جديدًا إلى Vidmoly من هذه الصفحة.',
    results: [],
  };
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const command = typeof req.body?.command === 'string' ? req.body.command : '';
  const activeDraft = req.body?.draft && typeof req.body.draft === 'object' ? req.body.draft : null;

  // Second phase of the "انشر" confirmation: the client already showed the
  // exact draft (title/cover/link) and the user pressed تأكيد. No command
  // text to parse here — publish the draft the user already reviewed,
  // rather than re-matching against the library a second time.
  if (req.body?.confirmPublish === true) {
    if (!activeDraft?.title || !activeDraft?.image) {
      return res.status(200).json({ text: 'لا توجد مسودة صالحة للنشر. اطلب النشر مرة أخرى.', action: 'publish-draft', published: false, results: [] });
    }
    try {
      const created = await publishDraftToSite(activeDraft);
      return res.status(200).json({ text: `تم نشر «${created.title}» على الموقع مباشرة.`, action: 'publish-draft', published: true, post: created, results: [] });
    } catch (error) {
      return res.status(200).json({ text: `تعذر النشر المباشر: ${error.message}. المسودة ما زالت متاحة — افتحها في نموذج النشر للمحاولة يدويًا.`, action: 'publish-draft', published: false, draft: activeDraft, results: [] });
    }
  }

  // Final step of "حمل وانشر": the client has been polling Vidmoly directly
  // (via /api/doodstream/upload-url/[code], the same endpoint the upload
  // page already uses) and just saw canplay:1. One more /file/info call
  // here confirms completion server-side and gets the definitive cover/
  // duration rather than trusting whatever the client last polled, then
  // publishes immediately — no confirm step, because typing the whole
  // "حمل وانشر ... باسم ..." command was already the explicit go-ahead.
  if (req.body?.finalizeUpload === true) {
    const fileCode = String(req.body?.fileCode || '').trim();
    const fallbackTitle = String(req.body?.title || '').trim();
    if (!fileCode || !fallbackTitle) {
      return res.status(200).json({ text: 'تعذر إكمال النشر التلقائي: بيانات الملف ناقصة.', action: 'upload-and-publish', published: false, results: [] });
    }
    let raw;
    try {
      const info = await vidmoly.fileInfo(fileCode);
      raw = Array.isArray(info.result) ? info.result[0] : info.result;
    } catch (error) {
      return res.status(200).json({ text: `التحميل خلص لكن تعذر تأكيد بياناته: ${error.message}. تحقق من صفحة الفيديوهات، وانشره بأمر «انشر ${fallbackTitle}» لما يبقى جاهز.`, action: 'upload-and-publish', published: false, results: [] });
    }
    // /upload/url's new_title param isn't reliably honored (confirmed
    // earlier for the manual upload flow) — force the typed title the same
    // way: an explicit /file/rename once the download is confirmed done,
    // rather than trusting whatever title Vidmoly reports on its own.
    if ((raw?.file_title || '') !== fallbackTitle) {
      try {
        await vidmoly.renameFile(fileCode, fallbackTitle);
        raw = { ...raw, file_title: fallbackTitle };
        try {
          await markVidmolySnapshotStale('library');
        } catch (staleError) {
          console.error('Could not mark library snapshot stale:', staleError.message);
        }
      } catch (error) {
        // Best-effort — publishes with whichever title Vidmoly actually has
        // rather than blocking the whole flow over a rename call failing.
      }
    }
    const details = getLibraryItemDetails({ ...raw, code: fileCode, file_code: fileCode, title: raw?.file_title || fallbackTitle });
    const draft = createLocalDraft(details);
    if (!draft.title || !draft.image) {
      return res.status(200).json({
        text: `التحميل خلص لكن لا توجد صورة غلاف متاحة بعد لـ«${draft.title || fallbackTitle}» من Vidmoly — جهّزت مسودة بدلًا من النشر التلقائي. افتحها في نموذج النشر لما الغلاف يبقى متاحًا.`,
        action: 'upload-and-publish',
        published: false,
        draft,
        results: [],
      });
    }
    try {
      const created = await publishDraftToSite(draft);
      return res.status(200).json({ text: `تم رفع «${created.title}» ونشره على الموقع تلقائيًا.`, action: 'upload-and-publish', published: true, post: created, results: [] });
    } catch (error) {
      return res.status(200).json({
        text: `التحميل خلص لكن تعذر النشر التلقائي: ${error.message}. جرّب أمر «انشر ${draft.title}» يدويًا.`,
        action: 'upload-and-publish',
        published: false,
        draft,
        results: [],
      });
    }
  }

  // Second phase of "غيّر عناوين ... حسب الحجم": the client already showed
  // the exact old→new list the user reviewed. Each rename here is a real
  // Vidmoly call, unlike the proposal phase which only read the cached
  // snapshot — this is why it's held behind its own confirm rather than
  // renaming the moment a size match is found.
  if (req.body?.confirmTitleMatches === true) {
    const matches = Array.isArray(req.body?.matches) ? req.body.matches.slice(0, MAX_RENAME_BATCH) : [];
    if (!matches.length) {
      return res.status(200).json({ text: 'لا توجد مقترحات صالحة للتنفيذ. شغّل أمر المطابقة تاني.', action: 'match-titles-by-size', applied: 0, results: [] });
    }
    let applied = 0;
    const failures = [];
    for (const item of matches) {
      const fileCode = String(item?.file_code || '').trim();
      const newTitle = String(item?.newTitle || '').trim();
      if (!fileCode || !newTitle) {
        failures.push('عنصر ناقص البيانات');
        continue;
      }
      try {
        await vidmoly.renameFile(fileCode, newTitle);
        applied += 1;
      } catch (error) {
        failures.push(`${item?.episode ?? fileCode}: ${error.message}`);
      }
    }
    if (applied > 0) {
      // Awaited for the same reason as the upload branch — see its comment.
      try {
        await markVidmolySnapshotStale('library');
      } catch (error) {
        console.error('Could not mark library snapshot stale:', error.message);
      }
    }
    const failText = failures.length ? ` تعذر تغيير: ${failures.join('، ')}.` : '';
    return res.status(200).json({
      text: `تم تصحيح ${applied} عنوان فعليًا على Vidmoly.${failText}`,
      action: 'match-titles-by-size',
      applied,
      results: [],
    });
  }

  const requestedAdvancedSearch = getAdvancedSearchInput(req.body?.advancedSearch);
  let training = null;
  try {
    training = await getTraining(session.id);
  } catch (error) {
    // Training is optional: the original local commands remain available if
    // its saved setting is temporarily unavailable.
    training = null;
  }
  const parsed = requestedAdvancedSearch
    ? { type: 'advanced-search', filters: requestedAdvancedSearch }
    : parseLocalCommand(command, training);
  const learned = Boolean(parsed.learned);
  const builtIn = Boolean(parsed.builtIn);

  let suggestionRecorded = false;
  if (isUnrecognizedLocalCommand(command, parsed)) {
    try {
      const recorded = await recordUnrecognizedPhrase(session.id, command);
      suggestionRecorded = Boolean(recorded.recorded);
    } catch (error) {
      // The command remains a safe help response if optional phrase collection
      // is unavailable; no command intent is guessed as a fallback.
      suggestionRecorded = false;
    }
  }

  if (parsed.type === 'help') {
    const text = suggestionRecorded
      ? `${helpText()} سجّلت عبارتك في «عبارات للمراجعة» لتختار معناها لاحقًا.`
      : helpText();
    return res.status(200).json({ text, learned, builtIn, suggestionRecorded, results: [] });
  }
  if (parsed.type === 'rename-draft') {
    if (!activeDraft?.title) return res.status(200).json({ text: 'لا توجد مسودة محلية لتعديلها. جهّز منشورًا من فيديو أولًا.', action: 'none', learned, builtIn, results: [] });
    return res.status(200).json({
      text: `سيُغيَّر عنوان المسودة إلى: ${parsed.title}`,
      action: 'rename-draft',
      learned,
      builtIn,
      draft: { ...activeDraft, title: parsed.title },
      results: [],
    });
  }
  if (parsed.type === 'delete-draft') {
    if (!activeDraft?.title) return res.status(200).json({ text: 'لا توجد مسودة محلية لحذفها.', action: 'none', learned, builtIn, results: [] });
    return res.status(200).json({ text: `سيُحذف تجهيز المسودة «${activeDraft.title}» فقط، ولن يُحذف أي فيديو أو منشور منشور.`, action: 'delete-draft', learned, builtIn, results: [] });
  }
  if (parsed.type === 'external-synopsis') {
    return res.status(200).json({
      text: `جارٍ التحقق من النص المنشور لـ${parsed.episode ? `الحلقة ${parsed.episode} من ` : ''}«${parsed.title}» في مصدر عام مستقل. لن أقرأ مكتبة Vidmoly ولن أُنشئ مسودة أو منشورًا.`,
      action: 'external-synopsis',
      synopsisRequest: { title: parsed.title, episode: parsed.episode || undefined },
      learned,
      builtIn,
      results: [],
    });
  }
  if (parsed.type === 'upload-and-publish') {
    if (!/^https?:\/\//i.test(parsed.url)) {
      return res.status(200).json({ text: 'الرابط لازم يبدأ بـ http:// أو https://.', action: 'upload-and-publish', started: false, learned, builtIn, results: [] });
    }
    try {
      const data = await vidmoly.addRemoteUpload(parsed.url, { new_title: parsed.title });
      if (data?.status !== 200) {
        return res.status(200).json({ text: `تعذر بدء التحميل: ${data?.msg || 'رفض Vidmoly الطلب.'}`, action: 'upload-and-publish', started: false, learned, builtIn, results: [] });
      }
      const raw = Array.isArray(data.result) ? data.result[0] : data.result;
      const fileCode = raw?.filecode || raw?.file_code || raw?.code || null;
      // Awaited deliberately: Vercel can freeze a serverless invocation right
      // after the response is sent, so a fire-and-forget write here can
      // silently never land — which is exactly what made the dashboard not
      // show this upload even once it had finished.
      try {
        await markVidmolySnapshotStale('library');
      } catch (error) {
        console.error('Could not mark library snapshot stale:', error.message);
      }
      if (!fileCode) {
        return res.status(200).json({
          text: `بدأ تحميل «${parsed.title}» لكن تعذر تحديد رمز الملف لمتابعته تلقائيًا. تابعه من صفحة الفيديوهات، وانشره بأمر «انشر ${parsed.title}» لما يخلص.`,
          action: 'upload-and-publish',
          started: true,
          polling: false,
          learned,
          builtIn,
          results: [],
        });
      }
      return res.status(200).json({
        text: `بدأ تحميل «${parsed.title}». هتابعه تلقائيًا وأنشره بمجرد ما يخلص (حتى 28 دقيقة، لأن بعض المصادر بتحمّل ببطء) — من غير تأكيد إضافي، ده نشر فعلي. سيب الصفحة مفتوحة لحد ما يخلص، ولو قفلتها هتلاقي الفيديو محمّل في صفحة الفيديوهات وتقدر تنشره بأمر «انشر» وقتها.`,
        action: 'upload-and-publish',
        started: true,
        polling: true,
        fileCode,
        title: parsed.title,
        learned,
        builtIn,
        results: [],
      });
    } catch (error) {
      return res.status(200).json({ text: `تعذر بدء التحميل: ${error.message}`, action: 'upload-and-publish', started: false, learned, builtIn, results: [] });
    }
  }

  if (parsed.type === 'batch-upload-and-publish') {
    // Each item polls independently on a shorter schedule than a single
    // "حمل وانشر" (~7 min instead of ~28) specifically because the cost
    // multiplies by batch size — 8 items already means up to ~70 Vidmoly
    // calls in the worst case (uploads + polls + finalizes) against the
    // 50/day quota, so the cap stays modest even though a single upload can
    // afford a much longer wait.
    const MAX_BATCH = 8;
    if (parsed.urls.length > MAX_BATCH) {
      return res.status(200).json({
        text: `عدد الروابط (${parsed.urls.length}) أكبر من الحد الآمن لأمر واحد (${MAX_BATCH} رابط) حتى لا تستهلك حصة Vidmoly اليومية دفعة واحدة. قسّمها على أكتر من أمر.`,
        action: 'batch-upload-and-publish',
        started: false,
        learned,
        builtIn,
        results: [],
      });
    }
    const items = [];
    const failures = [];
    for (let i = 0; i < parsed.urls.length; i += 1) {
      const episode = parsed.startEpisode + i;
      const title = `${parsed.series} - الحلقة ${episode}`;
      try {
        const data = await vidmoly.addRemoteUpload(parsed.urls[i], { new_title: title });
        if (data?.status !== 200) {
          failures.push(`الحلقة ${episode}: ${data?.msg || 'رفض Vidmoly الطلب'}`);
          continue;
        }
        const raw = Array.isArray(data.result) ? data.result[0] : data.result;
        const fileCode = raw?.filecode || raw?.file_code || raw?.code || null;
        if (!fileCode) {
          failures.push(`الحلقة ${episode}: تعذر تحديد رمز الملف`);
          continue;
        }
        items.push({ fileCode, title });
      } catch (error) {
        failures.push(`الحلقة ${episode}: ${error.message}`);
      }
    }
    if (items.length) {
      try {
        await markVidmolySnapshotStale('library');
      } catch (error) {
        console.error('Could not mark library snapshot stale:', error.message);
      }
    }
    const lastEpisode = parsed.startEpisode + parsed.urls.length - 1;
    const startedText = items.length
      ? `بدأ تحميل ${items.length} حلقة من «${parsed.series}» (${parsed.startEpisode}${lastEpisode > parsed.startEpisode ? `-${lastEpisode}` : ''}). هتابع كل واحدة لحد 7 دقايق وأنشرها فور اكتمالها تلقائيًا بلا تأكيد إضافي — لو حلقة أخدت وقت أطول من كده (وارد مع مصادر بطيئة) هتلاقي رسالة تقولك تنشرها يدويًا بأمر «انشر» بمجرد ما تخلص. سيب الصفحة مفتوحة قد ما تقدر.`
      : 'تعذر بدء أي تحميل من الروابط المرسلة.';
    const failText = failures.length ? ` تعذر بدء: ${failures.join('، ')}.` : '';
    return res.status(200).json({
      text: startedText + failText,
      action: 'batch-upload-and-publish',
      started: items.length > 0,
      items,
      learned,
      builtIn,
      results: [],
    });
  }

  let snapshot;
  try {
    snapshot = await getDashboardSetting(LIBRARY_SNAPSHOT_KEY);
  } catch (error) {
    return res.status(503).json({ error: 'تعذر قراءة نسخة مكتبة الفيديوهات المخزنة.' });
  }
  const files = collectLibraryFiles(snapshot?.payload || snapshot);
  if (!files.length) return res.status(200).json({ ...snapshotUnavailable(), learned, builtIn });

  if (parsed.type === 'match-titles-by-size') {
    const { proposals: allProposals, unresolved } = matchTitlesBySize(files, parsed.entries, parsed.series);
    if (!allProposals.length) {
      const unresolvedText = unresolved.length
        ? ` (${unresolved.map((u) => `الحلقة ${u.episode}${u.reason === 'ambiguous' ? ' — حجمها متطابق مع أكتر من فيديو' : ' — مفيش فيديو بنفس الحجم تقريبًا'}`).join('، ')})`
        : '';
      return res.status(200).json({
        text: `مفيش أي عنوان اتطابق من ${parsed.entries.length} المطلوبة${unresolvedText}. اتأكد إن الفيديوهات دي مرفوعة فعلًا ولسه بعنوانها العام (زي 1080p)، وإن حجمها في القايمة مقارب لحجمها الحقيقي على Vidmoly.`,
        action: 'match-titles-by-size',
        pendingTitleMatches: false,
        learned,
        builtIn,
        results: [],
      });
    }
    const proposals = allProposals.slice(0, MAX_RENAME_BATCH);
    const deferredCount = allProposals.length - proposals.length;
    const MAX_PREVIEW_LINES = 8;
    const preview = proposals.slice(0, MAX_PREVIEW_LINES).map((p) => `الحلقة ${p.episode}: «${p.oldTitle}» ← «${p.newTitle}»`).join('\n');
    const hiddenPreviewCount = proposals.length - Math.min(proposals.length, MAX_PREVIEW_LINES);
    const deferredNote = deferredCount > 0 ? `\n\nفي كمان ${deferredCount} تطابق مؤجل لحماية حصة اليوم — شغّل نفس الأمر تاني بعد ما دول يتنفذوا.` : '';
    const unresolvedNote = unresolved.length
      ? `\n\nتعذّر تحديد ${unresolved.length} حلقة بثقة: ${unresolved.map((u) => `${u.episode}${u.reason === 'ambiguous' ? ' (حجم مكرر)' : ' (بلا تطابق)'}`).join('، ')}.`
      : '';
    return res.status(200).json({
      text: `لقيت ${proposals.length} عنوان هصححه (من ${parsed.entries.length} المطلوبة):\n${preview}${hiddenPreviewCount > 0 ? `\n... و${hiddenPreviewCount} أخرى` : ''}${deferredNote}${unresolvedNote}\n\nده مقترح محلي بس، لسه محصلش أي تغيير على Vidmoly. اضغط تأكيد للتنفيذ الفعلي (${proposals.length} طلب من حصة اليوم).`,
      action: 'match-titles-by-size',
      pendingTitleMatches: true,
      matches: proposals,
      learned,
      builtIn,
      results: [],
    });
  }

  if (parsed.type === 'list') {
    const results = files.slice(0, 12).map(publicFile);
    return res.status(200).json({
      text: `توجد ${files.length} فيديوهات في النسخة المخزنة محليًا. هذه أحدث ${results.length} عناصر:`,
      action: 'list',
      learned,
      builtIn,
      results,
    });
  }

  const advanced = findAdvancedLibraryMatches(snapshot?.payload || snapshot, {
    query: parsed.query || '',
    ...(parsed.filters || {}),
  }, parsed.type === 'details' ? 1 : 12);
  const matches = advanced.results;
  if (parsed.type === 'advanced-search') {
    const sortLabels = { relevance: 'الأكثر صلة', newest: 'الأحدث رفعًا', largest: 'الأكبر حجمًا', 'most-viewed': 'الأكثر مشاهدة' };
    const filterBits = [advanced.filters.folder ? `المجلد «${advanced.filters.folder}»` : '', advanced.filters.minViews ? `على الأقل ${advanced.filters.minViews} مشاهدة` : '', advanced.filters.minSizeMb ? `على الأقل ${advanced.filters.minSizeMb} م.ب` : ''].filter(Boolean);
    return res.status(200).json({
      text: matches.length
        ? `وجدت ${matches.length} نتيجة محلية مرتبة حسب ${sortLabels[advanced.filters.sort] || sortLabels.relevance}${filterBits.length ? `، مع فلتر ${filterBits.join(' و')}` : ''}.`
        : 'لا توجد نتائج محلية مطابقة للفلاتر المحددة.',
      action: 'advanced-search',
      learned,
      builtIn,
      results: matches,
    });
  }
  if (parsed.type === 'details') {
    return res.status(200).json({
      text: matches.length ? `هذه التفاصيل المخزنة محليًا للفيديو الأقرب إلى «${parsed.query}».` : `لم أجد فيديو محليًا باسم «${parsed.query}».`,
      action: 'details',
      learned,
      builtIn,
      results: matches,
    });
  }
  if (parsed.type === 'search') {
    return res.status(200).json({
      text: matches.length ? `وجدت ${matches.length} نتيجة محلية لعبارة «${parsed.query}».` : `لم أجد نتيجة محلية لعبارة «${parsed.query}».`,
      action: 'search',
      learned,
      builtIn,
      results: matches,
    });
  }

  if (parsed.type === 'publish-draft') {
    const matched = findVidmolyLibraryMatch(parsed.query, snapshot?.payload || snapshot);
    if (!matched) {
      return res.status(200).json({ text: `لم أجد فيديو مناسبًا لنشر «${parsed.query}». جرّب أمر بحث باسم أقصر أو أدق.`, action: 'publish-draft', published: false, learned, builtIn, results: matches });
    }
    const draft = createLocalDraft(matched);
    // Publishing needs a title + cover image (same requirement the content
    // form enforces). Vidmoly doesn't always return a thumbnail for a given
    // file — when it's missing there is nothing safe to publish with, so
    // this falls back to the same review-first draft flow instead of
    // failing silently or guessing a cover.
    if (!draft.title || !draft.image) {
      return res.status(200).json({
        text: `تعذر نشر «${draft.title || parsed.query}» مباشرة لعدم توفر صورة غلاف لهذا الفيديو من Vidmoly. جهّزت مسودة بدلًا من ذلك — افتحها في نموذج النشر وأضف صورة الغلاف يدويًا.`,
        action: 'publish-draft',
        published: false,
        learned,
        builtIn,
        draft,
        results: [publicFile(matched)],
      });
    }

    const seriesGuess = guessSeriesFromTitle(draft.title);
    return res.status(200).json({
      text: seriesGuess
        ? `سيُنشر «${draft.title}» على الموقع مباشرة الآن ضمن سلسلة «${seriesGuess}». هذا نشر فعلي وليس مسودة — اضغط تأكيد للمتابعة، أو ألغِ وافتحه في نموذج النشر لمراجعته أولًا.`
        : `سيُنشر «${draft.title}» على الموقع مباشرة الآن. هذا نشر فعلي وليس مسودة — اضغط تأكيد للمتابعة، أو ألغِ وافتحه في نموذج النشر لمراجعته أولًا.`,
      action: 'publish-draft',
      pendingPublish: true,
      learned,
      builtIn,
      draft,
      results: [publicFile(matched)],
    });
  }

  const matched = findVidmolyLibraryMatch(parsed.query, snapshot?.payload || snapshot);
  if (!matched) {
    return res.status(200).json({ text: `لم أجد فيديو مناسبًا لتجهيز مسودة «${parsed.query}». جرّب أمر بحث باسم أقصر أو أدق.`, action: 'prepare-draft', learned, builtIn, results: matches });
  }
  const draft = createLocalDraft(matched);
  return res.status(200).json({
    text: `تم تجهيز مسودة محلية من «${draft.title}». لن يُنشأ أو يُنشر أي محتوى حتى تفتح النموذج وتضغط الحفظ بنفسك.`,
    action: 'prepare-draft',
    learned,
    builtIn,
    draft,
    results: [publicFile(matched)],
  });
}
