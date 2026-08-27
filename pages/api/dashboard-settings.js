// Backs /dashboard/settings: lets an admin rename the sidebar's own nav
// labels and the content-type labels used in "إضافة محتوى" (and add or
// remove types entirely — منشورات/مانهوا etc. aren't hardcoded, they're
// just entries in this list). Two different stores on purpose: sidebar
// labels are the dashboard tool's own UI text (this project's Supabase,
// wblgcebwcvvrtzrygeob), while content types are a property of the site's
// content model (the site's own Supabase, alongside posts/comments/etc.).
const { requireAuth } = require('../../lib/api-auth');
const { getDashboardSetting, saveDashboardSetting } = require('../../lib/db');
const { getSetting, saveSetting } = require('../../lib/siteDb');
const { POST_TYPES, normalizeContentTypes } = require('../../lib/animeContent');

const DEFAULT_SIDEBAR_LABELS = {
  videos: 'Videos',
  upload: 'Add video',
  content: 'إضافة محتوى',
  media: 'مكتبة الوسائط',
  statistics: 'إحصائيات المحتوى',
  contentManager: 'مدير المحتوى',
  comments: 'التعليقات',
  aiChat: 'منفذ الأوامر المحلي',
  settings: 'الإعدادات',
  team: 'Team',
};

const LEGACY_ANIME_STATISTICS_LABEL = 'إحصائيات الأنمي';
const LEGACY_AI_CHAT_LABELS = new Set(['✨ مساعد الذكاء الاصطناعي', 'مساعد الذكاء الاصطناعي']);

function normalizeSidebarLabels(labels) {
  const normalized = { ...DEFAULT_SIDEBAR_LABELS, ...(labels && typeof labels === 'object' ? labels : {}) };
  if (normalized.statistics === LEGACY_ANIME_STATISTICS_LABEL) {
    normalized.statistics = DEFAULT_SIDEBAR_LABELS.statistics;
  }
  if (LEGACY_AI_CHAT_LABELS.has(normalized.aiChat)) {
    normalized.aiChat = DEFAULT_SIDEBAR_LABELS.aiChat;
  }
  return normalized;
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const [sidebarOverride, contentTypesOverride] = await Promise.all([
        getDashboardSetting('sidebar_labels'),
        getSetting('content_types'),
      ]);
      return res.status(200).json({
        sidebarLabels: normalizeSidebarLabels(sidebarOverride),
        contentTypes: normalizeContentTypes(contentTypesOverride || POST_TYPES),
      });
    }

    if (req.method === 'POST') {
      const { sidebarLabels, contentTypes } = req.body || {};
      if (sidebarLabels) await saveDashboardSetting('sidebar_labels', normalizeSidebarLabels(sidebarLabels));
      if (contentTypes) await saveSetting('content_types', contentTypes);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
