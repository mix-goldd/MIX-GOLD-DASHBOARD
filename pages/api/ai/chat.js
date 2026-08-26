// AI chat assistant that can actually act on the dashboard, not just
// talk about it. Gemini decides which of the declared tools to call
// (and with what arguments); this route executes each call against the
// same lib/vidmoly.js functions every other page uses, feeds the real
// result back to Gemini, and loops until it has a plain-text answer —
// which always describes what was actually done, since the result of
// every action is what the model's final summary is grounded in.
//
// delete_file is deliberately NOT included as a tool. The docs screenshot
// that confirmed most of lib/vidmoly.js's endpoints showed /file/deleted
// (which reads like "list trashed files") where a delete action would be
// — the real delete endpoint's name was never confirmed. Wiring an
// unconfirmed, irreversible action into something a chat message can
// trigger is a bad combination; add it once the real endpoint is known.
const { requireAuth } = require('../../../lib/api-auth');
const gemini = require('../../../lib/gemini');
const vidmoly = require('../../../lib/vidmoly');
const aiMemory = require('../../../lib/aiMemory');

function extractFileArray(filesRes) {
  if (Array.isArray(filesRes.result)) return filesRes.result;
  if (Array.isArray(filesRes.result?.files)) return filesRes.result.files;
  if (Array.isArray(filesRes.result?.list)) return filesRes.result.list;
  if (Array.isArray(filesRes.result?.data)) return filesRes.result.data;
  return [];
}

// Crude but dependency-free HTML→text: drops script/style blocks, turns
// tags into whitespace, decodes the handful of entities that actually
// show up in body text, collapses runs of blank space. Good enough to
// hand a page's visible text to Gemini — not meant to preserve layout.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'list_files',
        description: 'يسرد فيديوهات الموقع، مع إمكانية الفلترة بجزء من العنوان. استخدمها دايمًا الأول قبل أي إجراء على ملف عشان تتأكد من الكود الصحيح بتاعه.',
        parameters: {
          type: 'OBJECT',
          properties: { query: { type: 'STRING', description: 'جزء من العنوان للبحث عنه (اختياري، اسيبه فاضي عشان كل الملفات)' } },
        },
      },
      {
        name: 'list_folders',
        description: 'يسرد كل المجلدات الموجودة في الحساب.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'rename_file',
        description: 'يغيّر عنوان فيديو موجود بالفعل.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_code: { type: 'STRING', description: 'كود الملف، لازم يكون جاي من list_files' },
            title: { type: 'STRING', description: 'العنوان الجديد' },
          },
          required: ['file_code', 'title'],
        },
      },
      {
        name: 'move_file',
        description: 'ينقل فيديو موجود لمجلد معين، بالاسم.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_code: { type: 'STRING', description: 'كود الملف، لازم يكون جاي من list_files' },
            folder_name: { type: 'STRING', description: 'اسم المجلد، لازم يكون جاي من list_folders' },
          },
          required: ['file_code', 'folder_name'],
        },
      },
      {
        name: 'create_folder',
        description: 'ينشئ مجلد جديد.',
        parameters: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING' } },
          required: ['name'],
        },
      },
      {
        name: 'fetch_url',
        description:
          'يجيب النص الحقيقي الظاهر في صفحة ويب معينة، عن طريق رابطها المباشر. استخدمها لو معاك رابط صفحة محددة وعاوز تفاصيل أدق أو أطول منها مما رجعه البحث.',
        parameters: {
          type: 'OBJECT',
          properties: { url: { type: 'STRING', description: 'رابط الصفحة الكامل، يبدأ بـ https://' } },
          required: ['url'],
        },
      },
    ],
  },
  // Native Google Search grounding — separate from the custom actions
  // above. The model doesn't "call" this by name the way it calls
  // list_files etc.; Google's own infrastructure searches and grounds
  // the response transparently, so a plain-text answer can already be
  // search-grounded with no functionCall part to execute. Confirmed as
  // the real tool name from Google AI Studio's own "Get code" panel for
  // this account (tools = [{'type': 'google_search'}]), not guessed.
  // Unverified: whether Gemini's v1beta REST API accepts this mixed in
  // the same tools array as custom functionDeclarations — some Gemini
  // versions historically didn't allow combining built-in and custom
  // tools in one call. If that's still true here, expect a 400 with the
  // real constraint spelled out (same as the earlier role:'function'
  // error) rather than a silent failure — that error is what settles it
  // for real, not another guess.
  { google_search: {} },
];

const SYSTEM_INSTRUCTION =
  'انت مساعد لوحة تحكم موقع أنمي/مانجا، وبتقدر تنفذ إجراءات حقيقية (مش بس تقترح) عن طريق الأدوات المتاحة لك. ' +
  'قبل أي إجراء على ملف معين، استخدم list_files الأول عشان تتأكد من كود الملف الصحيح — متفترضش كود من عندك. ' +
  'معاك بحث حقيقي على جوجل — لو المستخدم طلب معلومة حقيقية (زي ملخص حلقة مسلسل)، متجاوبش من معرفتك العامة أبدًا، ابحث فعليًا الأول واستند لنتائج البحث الحقيقية. لو محتاج تفاصيل أدق من صفحة معينة ظهرت في نتائج البحث، استخدم fetch_url عليها. ' +
  'قاعدة مصادر مهمة: أفلام ومسلسلات عربي — دور في elcinema.com تحديدًا. أنمي — دور في مصادر الويكي المتخصصة (زي Wikipedia أو أي أنمي ويكي معروف). ' +
  'لو مقدرتش تتأكد من معلومة حقيقية بعد البحث، قول للمستخدم كده صراحة وممكن يبعتلك النص بنفسه، بدل ما تخترعها. ' +
  'بعد ما تنفذ أي إجراء، لازم ترد على المستخدم برسالة نصية واضحة تقوله فيها بالظبط إيه اللي عملته (أو ليه فشل لو فشل). ' +
  'لو المستخدم طلب حاجة هتحذف أو تغيّر حاجة موجودة بشكل نهائي ومفيش أداة واضحة ليها، قوله إن الإجراء ده مش متاح دلوقتي بدل ما تحاول تتحايل عليه بأداة تانية.';

async function executeFunction(name, args) {
  switch (name) {
    case 'list_files': {
      const filesRes = await vidmoly.listFiles();
      if (filesRes.status !== 200) return { error: 'Could not list files.', raw: filesRes };
      const all = extractFileArray(filesRes);
      const q = (args.query || '').trim().toLowerCase();
      const filtered = q ? all.filter((f) => (f.title || '').toLowerCase().includes(q)) : all;
      return {
        files: filtered.slice(0, 30).map((f) => ({
          file_code: f.file_code || f.filecode || f.code,
          title: f.title,
          uploaded: f.uploaded,
        })),
        total_matched: filtered.length,
      };
    }
    case 'list_folders': {
      const foldersRes = await vidmoly.listFolder(0);
      if (foldersRes.status !== 200) return { error: 'Could not list folders.', raw: foldersRes };
      const folders = Array.isArray(foldersRes.result?.folders) ? foldersRes.result.folders : [];
      return { folders: folders.map((f) => ({ fld_id: f.fld_id, name: f.name })) };
    }
    case 'rename_file': {
      if (!args.file_code || !args.title) return { success: false, error: 'file_code and title are both required.' };
      const result = await vidmoly.renameFile(args.file_code, args.title);
      return { success: result.status === 200, raw: result };
    }
    case 'move_file': {
      if (!args.file_code || !args.folder_name) {
        return { success: false, error: 'file_code and folder_name are both required.' };
      }
      const foldersRes = await vidmoly.listFolder(0);
      const folders = Array.isArray(foldersRes.result?.folders) ? foldersRes.result.folders : [];
      const folder = folders.find((f) => (f.name || '').toLowerCase() === args.folder_name.toLowerCase());
      if (!folder) return { success: false, error: `No folder named "${args.folder_name}" was found — call list_folders to check the exact name.` };
      const result = await vidmoly.moveFile(args.file_code, folder.fld_id);
      return { success: result.status === 200, raw: result };
    }
    case 'create_folder': {
      if (!args.name) return { success: false, error: 'name is required.' };
      const result = await vidmoly.createFolder(args.name);
      return { success: result.status === 200, raw: result };
    }
    case 'fetch_url': {
      if (!args.url) return { error: 'url is required.' };
      let res;
      try {
        res = await fetch(args.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DashboardBot/1.0)' },
        });
      } catch (err) {
        return { error: `Could not reach the URL: ${err.message}` };
      }
      if (!res.ok) return { error: `The page returned an error (${res.status}).` };
      const html = await res.text();
      // Capped well under Gemini's context limit — this is meant to give
      // the model enough of the page to answer one question accurately,
      // not the whole document.
      const text = htmlToText(html).slice(0, 6000);
      if (!text) return { error: 'The page had no readable text content.' };
      return { url: args.url, text };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages is required.' });
  }

  try {
    const contents = messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    const actions = [];
    let memoryInstruction = '';
    try {
      memoryInstruction = aiMemory.buildMemoryInstruction(await aiMemory.getMemory(session.id));
    } catch (_) {
      // The assistant remains usable if the optional preference store is temporarily unavailable.
    }

    // Function-calling loop, capped so a confused model can't spiral
    // into repeated tool calls forever.
    for (let i = 0; i < 5; i++) {
      const { candidate } = await gemini.generateChat(contents, {
        tools: TOOLS,
        systemInstruction: SYSTEM_INSTRUCTION + memoryInstruction,
      });
      const parts = candidate?.content?.parts || [];
      const calls = parts.filter((p) => p.functionCall);

      if (!calls.length) {
        const text = parts.map((p) => p.text || '').join('').trim();
        return res.status(200).json({ text: text || 'تمام.', actions });
      }

      contents.push({ role: 'model', parts });
      const responseParts = [];
      for (const part of calls) {
        const { name, args } = part.functionCall;
        let result;
        try {
          result = await executeFunction(name, args || {});
        } catch (err) {
          result = { success: false, error: err.message };
        }
        actions.push({ name, args, result });
        responseParts.push({ functionResponse: { name, response: result } });
      }
      // Gemini's live error for this rejected 'function' outright and
      // listed its actual accepted roles (SYSTEM/USER/ASSISTANT/
      // DEVELOPER/CONTEXT/USER_CONTEXT/MODEL/USER) — 'function' isn't
      // one of them for this API surface, despite being the traditional
      // Gemini function-calling convention. 'user' is what's confirmed
      // to work; the functionResponse part type itself is unaffected.
      contents.push({ role: 'user', parts: responseParts });
    }

    return res.status(200).json({
      text: 'حصل لبس وأنا بحاول أنفذ الطلب ده — ممكن تعيد صياغته بشكل أبسط؟',
      actions,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
