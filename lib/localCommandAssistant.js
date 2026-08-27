const { normalizeText } = require('./vidmolyLibraryMatch');

function stripQuotes(value) {
  return String(value || '').trim().replace(/^["'«]+|["'»]+$/g, '').trim();
}

function createLocalDraft(match) {
  if (!match) return null;
  return {
    type: 'video',
    file_code: match.file_code || '',
    title: match.title || '',
    image: match.thumbnail_url || '',
    url: match.playback_url || '',
    download_url: match.download_url || '',
    duration: match.duration || '',
  };
}

function parseLocalCommand(value) {
  const command = String(value || '').trim();
  const normalized = normalizeText(command);
  if (!normalized) return { type: 'help' };

  if (/^(?:اعرض|عرض|وريني|اريني|اظهر|أظهر).*(?:فيديوهات|الفيديوهات|ملفات|الملفات|مكتبة|المكتبه)/.test(normalized) || /^(?:كم|عدد).*(?:فيديو|فيديوهات|ملف|ملفات)/.test(normalized)) {
    return { type: 'list' };
  }

  const removeDraft = command.match(/^(?:احذف|امسح)\s+(?:المسودة|مسودة)(?:\s+الحالية)?\s*$/i);
  if (removeDraft) return { type: 'delete-draft' };

  const renameDraft = command.match(/^(?:غير|غيّر|عدل|عدّل)\s+(?:عنوان\s+)?(?:المسودة|مسودة)(?:\s+إلى|\s+لـ|\s+ل)\s+(.+)$/i);
  if (renameDraft) {
    const title = stripQuotes(renameDraft[1]);
    return title ? { type: 'rename-draft', title } : { type: 'help' };
  }

  const search = command.match(/^(?:ابحث|دور|دوّر|فتش)(?:\s+(?:عن|في))?\s+(.+)$/i);
  if (search) {
    const query = stripQuotes(search[1]);
    return query ? { type: 'search', query } : { type: 'help' };
  }

  const prepare = command.match(/^(?:جهز|جهّز|حضر|حضّر|انشئ|أنشئ|انشر)\s+(?:(?:مسودة|منشور)\s+)?(.+)$/i);
  if (prepare) {
    const query = stripQuotes(prepare[1]).replace(/^(?:نشر|النشر)\s+/i, '').trim();
    return query ? { type: 'prepare-draft', query } : { type: 'help' };
  }

  return { type: 'help' };
}

function helpText() {
  return 'أنا منفذ أوامر محلي مجاني، ولا أستخدم Gemini. جرّب: «اعرض الفيديوهات»، «ابحث عن One Piece»، «جهّز نشر الحلقة 1 من One Piece»، «غيّر عنوان المسودة إلى …»، أو «احذف المسودة». النشر النهائي لا يتم من هنا.';
}

module.exports = { createLocalDraft, helpText, parseLocalCommand };
