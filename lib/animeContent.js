// Anime content section — shared constants and pure helpers used by the
// content-manager and content pages. Actual data (categories, sidebar
// items, homepage sections, posts) now lives in the S-E website's
// Supabase project (see lib/siteDb.js) instead of localStorage, so it
// publishes live to the real site instead of staying on one device.

export const POST_TYPES = [
  // A playable entry is one unified record: the visitor-facing post and its
  // anime episode metadata share the same `posts` row and Vidmoly URL.
  { value: 'video', label: 'منشور / فيديو', icon: 'fa-play-circle' },
  { value: 'image', label: 'فنون وتصاميم', icon: 'fa-palette' },
  { value: 'manga', label: 'فصل مانجا', icon: 'fa-book-open' },
  { value: 'model', label: 'شخصية', icon: 'fa-user-ninja' },
];

// Stored site settings may still contain the old label "حلقة أنمي". Keep the
// stable internal value (`video`) but always expose the merged visitor-facing
// label so the editor cannot present two separate episode/post choices.
export function normalizeContentTypes(raw) {
  const source = Array.isArray(raw) && raw.length ? raw : POST_TYPES;
  const seen = new Set();
  const unifiedVideoValues = new Set(['video', 'post', 'episode', 'anime_episode', 'anime-episode']);
  const unifiedVideoLabels = new Set(['منشور', 'حلقة أنمي', 'منشور حلقة أنمي', 'منشور / حلقة أنمي', 'منشور / فيديو']);
  const generalizedLabels = {
    'فن أنمي': 'فنون وتصاميم',
    'شخصية أنمي': 'شخصية',
  };
  const normalized = source
    .map((entry) => {
      if (typeof entry === 'string') return { value: entry, label: entry };
      return entry && typeof entry === 'object' ? { ...entry } : null;
    })
    .filter((entry) => entry && entry.value)
    .map((entry) => {
      const value = String(entry.value).trim();
      const label = String(entry.label || '').trim();
      if (unifiedVideoValues.has(value) || unifiedVideoLabels.has(label)) {
        return { ...entry, value: 'video', label: 'منشور / فيديو', icon: entry.icon || 'fa-play-circle' };
      }
      return generalizedLabels[label] ? { ...entry, label: generalizedLabels[label] } : entry;
    })
    .filter((entry) => {
      if (seen.has(entry.value)) return false;
      seen.add(entry.value);
      return true;
    });

  if (!seen.has('video')) normalized.unshift(POST_TYPES[0]);
  return normalized;
}

export const SIDEBAR_PARENTS = [
  { value: 'main', label: 'القائمة الرئيسية' },
  { value: 'video', label: 'قائمة الفيديوهات' },
  { value: 'comics', label: 'قائمة المانجا' },
  { value: 'studio', label: 'الاستوديوهات والسلاسل' },
];

// The site's built-in sidebar sections (as opposed to the custom items
// added above). Fixed list/order — matches the keys rebuildSidebar() on
// the site checks against nav_locks for.
export const CORE_NAV_ITEMS = [
  { key: 'home', label: 'الرئيسية (Home)' },
  { key: 'video', label: 'تصنيفات الفيديو (Video Categories)' },
  { key: 'studio', label: 'الاستوديوهات والسلاسل (Studio & Series)' },
  { key: 'models', label: 'الشخصيات (Models)' },
  { key: 'pulsex', label: 'PulseX' },
  { key: 'comics', label: 'المانجا (Comics)' },
  { key: 'saved', label: 'المحفوظات (Saved)' },
  { key: 'notifications', label: 'الإشعارات (Notifications)' },
  { key: 'watch-history', label: 'سجل المشاهدة (Watch History)' },
  { key: 'settings', label: 'الإعدادات (Settings)' },
];

// Categories used to be stored as a plain array of names. They now carry
// an "enabled" toggle too, so they're stored as { name, enabled }. This
// reads either shape and always returns the new one, so old saved data
// (and old code paths) keep working without a migration.
export function normalizeCategories(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? { name: c, enabled: true } : c))
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
    .map((c) => ({ name: c.name, enabled: c.enabled !== false }));
}

// Vidmoly returns duration as raw seconds (e.g. 38). Anywhere we show
// it to a human it should read like "0:38", not the bare number — but if
// it's already formatted (contains ":"), or isn't a plain number, leave
// it untouched.
export function formatDuration(value) {
  if (value === null || value === undefined || value === '') return '';
  const str = String(value).trim();
  if (!str) return '';
  if (str.includes(':')) return str;
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0) return str;
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function parseViews(viewValue) {
  if (typeof viewValue === 'number') return viewValue;
  if (!viewValue) return 0;
  const str = viewValue.toString().toUpperCase();
  let multiplier = 1;
  if (str.includes('K')) multiplier = 1000;
  else if (str.includes('M')) multiplier = 1000000;
  const num = parseFloat(str.replace(/[KM]/i, '')) || 0;
  return num * multiplier;
}

export function formatViewsNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}
