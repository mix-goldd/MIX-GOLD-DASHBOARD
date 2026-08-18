import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Layout from '../../components/Layout';
import Dropdown from '../../components/Dropdown';
import { getSessionFromReq } from '../../lib/auth';
import { formatViewsNumber, POST_TYPES } from '../../lib/animeContent';
import { listPosts, listPostViews, listSiteVisits } from '../../lib/siteDb';

// Browser-side only, for the realtime subscriptions below — safe to expose:
// it's the exact same anon key + tables the public S-E site already reads
// with in every visitor's browser, and both post_views' and site_visits'
// RLS policies already grant anon a wide-open SELECT, so this adds no new
// exposure. Needs both vars set in Vercel; if either is missing the page
// just falls back to the manual "تحديث" / tab-refocus catch-up below
// instead of live push.
const SITE_SUPABASE_URL = process.env.NEXT_PUBLIC_SITE_SUPABASE_URL;
const SITE_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SITE_SUPABASE_ANON_KEY;

// Every period the range dropdown offers. `since` controls the caption
// under the left edge of the chart ("منذ ..."), kept separate from
// `label` (the dropdown's own text) because "منذ السنة" / "منذ إلى
// الأبد" don't read naturally in Arabic the way "منذ سنة" / "منذ
// البداية" do. `ms` is the window size used to bucket real event rows;
// 'all' has no fixed window — it starts from the earliest recorded
// event instead.
// `buckets` sets the main chart's resolution per range — chosen as clean
// time units per bar (1min/30min/1h/3h/12h/1wk) rather than one fixed
// count for every range, capped around 60 so bars stay wide enough to
// read on a phone screen.
const RANGE_OPTIONS = [
  { value: '60m', label: '60 دقيقة', since: 'منذ 60 دقيقة', ms: 60 * 60 * 1000, buckets: 60 }, // 1 min/bar
  { value: '24h', label: '24 ساعة', since: 'منذ 24 ساعة', ms: 24 * 60 * 60 * 1000, buckets: 48 }, // 30 min/bar
  { value: '48h', label: '48 ساعة', since: 'منذ 48 ساعة', ms: 48 * 60 * 60 * 1000, buckets: 48 }, // 1 h/bar
  { value: '7d', label: 'أسبوع', since: 'منذ أسبوع', ms: 7 * 24 * 60 * 60 * 1000, buckets: 56 }, // 3 h/bar
  { value: '30d', label: 'شهر', since: 'منذ شهر', ms: 30 * 24 * 60 * 60 * 1000, buckets: 60 }, // 12 h/bar
  { value: '365d', label: 'السنة', since: 'منذ سنة', ms: 365 * 24 * 60 * 60 * 1000, buckets: 52 }, // 1 wk/bar
  { value: 'all', label: 'إلى الأبد', since: 'منذ البداية', ms: null, buckets: 30 },
];

// Range pills for the per-post "view details" modal — mirrors the range
// options above but kept separate: this list drives its own since-label
// text below the modal's chart instead of reusing RANGE_OPTIONS.since.
const DETAIL_RANGE_OPTIONS = [
  { value: '7d', label: '7 أيام', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '28d', label: '28 يومًا', ms: 28 * 24 * 60 * 60 * 1000 },
  { value: '90d', label: '90 يومًا', ms: 90 * 24 * 60 * 60 * 1000 },
  { value: '365d', label: '365 يومًا', ms: 365 * 24 * 60 * 60 * 1000 },
  { value: 'all', label: 'إلى الأبد', ms: null },
];

// Recognizable android-app:// package referrers -> a readable Arabic label.
// Anything else falls back to the bare hostname (or the raw string if it
// isn't a parseable URL at all).
const KNOWN_APP_REFERRERS = {
  'org.telegram.messenger': 'تيليجرام',
  'com.whatsapp': 'واتساب',
  'com.facebook.katana': 'فيسبوك',
  'com.facebook.orca': 'ماسنجر',
  'com.instagram.android': 'انستجرام',
  'com.twitter.android': 'تويتر / X',
  'com.google.android.gm': 'جيميل',
  'com.google.android.googlequicksearchbox': 'بحث جوجل',
};

// language codes -> Arabic display names for the common cases; anything
// else just shows the raw code (e.g. "pl-PL") rather than guessing wrong.
const LANGUAGE_NAMES = {
  ar: 'العربية', en: 'الإنجليزية', fr: 'الفرنسية', es: 'الإسبانية',
  de: 'الألمانية', tr: 'التركية', ru: 'الروسية', it: 'الإيطالية',
  pt: 'البرتغالية', hi: 'الهندية', ja: 'اليابانية', ko: 'الكورية', zh: 'الصينية',
};

function normalizeBrowserName(ua) {
  if (!ua) return 'غير معروف';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
  if (/ucbrowser/i.test(ua)) return 'UC Browser';
  if (/firefox\//i.test(ua) || /fxios\//i.test(ua)) return 'Firefox';
  if (/crios\//i.test(ua)) return 'Chrome';
  if (/chrome\//i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua)) return 'Safari';
  return 'أخرى';
}

function browserIconClass(name) {
  switch (name) {
    case 'Chrome': return 'fab fa-chrome';
    case 'Firefox': return 'fab fa-firefox-browser';
    case 'Safari': return 'fab fa-safari';
    case 'Edge': return 'fab fa-edge';
    case 'Opera': return 'fab fa-opera';
    default: return 'fas fa-globe';
  }
}

// `os` (navigator.platform) is unreliable on mobile (e.g. "Linux armv8l"
// for Android), so this checks the full user-agent first and only falls
// back to the raw platform string if nothing recognizable turns up.
function normalizePlatformName(platform, ua) {
  const src = `${ua || ''} ${platform || ''}`;
  if (/android/i.test(src)) return 'Android';
  if (/iphone|ipad|ipod/i.test(src)) return 'iOS';
  if (/windows/i.test(src)) return 'Windows';
  if (/mac os x|macintosh/i.test(src)) return 'macOS';
  if (/linux/i.test(src)) return 'Linux';
  return platform || 'غير معروف';
}

function platformIconClass(name) {
  switch (name) {
    case 'Android': return 'fab fa-android';
    case 'iOS': return 'fab fa-apple';
    case 'macOS': return 'fab fa-apple';
    case 'Windows': return 'fab fa-windows';
    case 'Linux': return 'fab fa-linux';
    default: return 'fas fa-desktop';
  }
}

function normalizeLanguageName(lang) {
  if (!lang) return 'غير معروف';
  const code = lang.toLowerCase().split('-')[0];
  return LANGUAGE_NAMES[code] || lang;
}

function normalizeReferrerLabel(referrer) {
  if (!referrer || referrer === 'Direct') return 'مباشر';
  const appMatch = referrer.match(/^android-app:\/\/([\w.]+)/i);
  if (appMatch) return KNOWN_APP_REFERRERS[appMatch[1]] || appMatch[1];
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host || referrer;
  } catch {
    return referrer;
  }
}

// ISO 3166-1 alpha-2 -> flag emoji, via the regional-indicator-symbol trick
// (each letter maps to its own Unicode "regional indicator" codepoint; two
// of them next to each other render as that country's flag on any platform
// with emoji-flag support). No country_code on the row -> no flag, just the
// plain white-flag fallback used everywhere below.
function countryFlagEmoji(code) {
  if (!code || code.length !== 2) return '🏳️';
  const points = code.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
}

// Same shape as topCounts()'s output, but grouped by country name while
// keeping one representative country_code per group so the breakdown row
// can render a flag next to it — topCounts() itself only tracks the label
// it groups by, which would drop the code.
function topCountryCounts(items, limit = 5) {
  const map = new Map();
  for (const item of items) {
    const key = item.country || 'غير معروف';
    if (!map.has(key)) map.set(key, { count: 0, code: item.country_code });
    map.get(key).count += 1;
  }
  const total = items.length || 1;
  return Array.from(map.entries())
    .map(([label, { count, code }]) => ({ label, code, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Groups `items` by `keyFn(item)` and returns the top `limit` groups by
// count, each with its share of the total as a rounded percentage — the
// percentage is what drives each breakdown row's bar width.
function topCounts(items, keyFn, limit = 5) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'غير معروف';
    map.set(key, (map.get(key) || 0) + 1);
  }
  const total = items.length || 1;
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function relativeTimeAr(ts) {
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `منذ ${diffMin} ${diffMin === 1 ? 'دقيقة' : 'دقائق'}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} ${diffHr === 1 ? 'ساعة' : 'ساعات'}`;
  const diffDay = Math.round(diffHr / 24);
  return `منذ ${diffDay} ${diffDay === 1 ? 'يوم' : 'أيام'}`;
}

// Absolute date + time, precise to the minute (e.g. "2026/07/24 - 04:02") —
// used in the view-details modal's event list, where "متى بالضبط" matters
// more than a rolling "منذ ..." label.
function absoluteDateTimeAr(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} - ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Splits `timestamps` (epoch ms, already filtered to [sinceTs, nowTs])
// into `bucketCount` equal-width buckets across that window and counts
// how many land in each — this is what actually turns raw event rows
// into the chart's bar heights.
function bucketCounts(timestamps, sinceTs, nowTs, bucketCount) {
  const buckets = new Array(bucketCount).fill(0);
  const span = Math.max(nowTs - sinceTs, 1);
  for (const ts of timestamps) {
    let idx = Math.floor(((ts - sinceTs) / span) * bucketCount);
    if (idx >= bucketCount) idx = bucketCount - 1;
    if (idx < 0) idx = 0;
    buckets[idx] += 1;
  }
  return buckets;
}

// Bucket counts (raw counts, could be 0..n) -> bar heights as a
// percentage, scaled against the tallest bucket. A tiny floor keeps
// zero-count buckets visible as a sliver instead of disappearing.
function toBarHeights(counts) {
  const max = Math.max(...counts, 1);
  return counts.map((c) => (c === 0 ? 3 : Math.max(8, Math.round((c / max) * 100))));
}

// Same sliding-number effect used for the views/likes/dislikes counters on
// the public site's post detail page (see .ticker-viewport / .ticker-column
// / .ticker-digit and updateTicker() there) — ported here so the dashboard's
// view numbers roll the same way instead of just snapping to the new value.
// It's imperative on purpose (direct style/innerHTML writes instead of
// state-driven JSX) because the effect depends on forcing a layout reflow
// between "jump to the pre-animation position" and "turn the transition
// back on", which is exactly what the site's own version does with a
// double requestAnimationFrame — trying to do that through React state
// would just fight the same reflow timing.
function Ticker({ value }) {
  const columnRef = useRef(null);
  const prevValueRef = useRef(null);
  const prevFormattedRef = useRef(null);

  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const formattedNew = formatViewsNumber(value);

    if (prevFormattedRef.current === null) {
      // First render — the JSX below already shows the right digit, just
      // record the baseline so the *next* change has something to animate from.
      prevFormattedRef.current = formattedNew;
      prevValueRef.current = value;
      return;
    }

    if (prevFormattedRef.current === formattedNew) {
      prevValueRef.current = value;
      return;
    }

    const isIncreasing = value >= prevValueRef.current;
    const oldHtml = `<span class="ticker-digit">${prevFormattedRef.current}</span>`;
    const newHtml = `<span class="ticker-digit">${formattedNew}</span>`;

    column.style.transition = 'none';
    column.innerHTML = isIncreasing ? newHtml + oldHtml : oldHtml + newHtml;

    const digitEl = column.querySelector('.ticker-digit');
    const digitHeight = digitEl ? digitEl.offsetHeight : 20;

    if (isIncreasing) {
      column.style.transform = `translateY(-${digitHeight}px)`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          column.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
          column.style.transform = 'translateY(0)';
        });
      });
    } else {
      column.style.transform = 'translateY(0)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          column.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
          column.style.transform = `translateY(-${digitHeight}px)`;
        });
      });
    }

    prevFormattedRef.current = formattedNew;
    prevValueRef.current = value;
  }, [value]);

  return (
    <span className="ticker-viewport">
      <span className="ticker-column" ref={columnRef}>
        <span className="ticker-digit">{formatViewsNumber(value)}</span>
      </span>
    </span>
  );
}

// The main "إجمالي الزيارات" chart, but always creeping — a seamless CSS
// loop instead of a JS-timed slide+reset (the previous version tried to
// time a setTimeout to match a CSS transition's duration; any drift
// between the two — and there's always some — showed up as a bar
// visibly failing to finish its slide before snapping back). This
// version renders the bars twice back-to-back and animates the strip
// exactly one copy's width via a CSS @keyframes loop: since copy 2 is
// pixel-identical to copy 1, the instant the animation wraps back to
// 0% it's showing the same thing it was already showing — no seam,
// no snap, nothing for the browser to get out of sync with. Real bar
// heights still come straight from `heights` on every render; this
// only owns the motion.
//
// One full loop (first bar's slot all the way to the last) takes exactly
// the selected range's real duration — for "60 دقيقة" the strip finishes
// one full sweep in 60 real minutes, for "24 ساعة" in 24 real hours, and
// so on, so the motion genuinely tracks the window emptying and refilling
// in real time rather than an arbitrary decorative pace. "إلى الأبد" has
// no fixed window at all (ms is null), so there's no real duration for
// the motion to track — it's frozen instead of picking an arbitrary one.
function chartCycleSeconds(rangeMs) {
  if (!rangeMs) return null; // 'all' — frozen, see above
  return rangeMs / 1000;
}

function LiveSlidingChart({ heights, counts, rangeMs }) {
  const cycleSeconds = chartCycleSeconds(rangeMs);
  // Ranges with more bars (60m's 60, vs the old fixed 30) need a
  // tighter gap or the bars themselves get squeezed too thin to read.
  const gap = heights.length > 40 ? '1.5px' : '3px';
  const stripStyle = {
    gap,
    ...(cycleSeconds ? { animationDuration: `${cycleSeconds}s` } : {}),
  };

  // Tap a bar to read its exact count — the animation keeps moving the
  // bars themselves, so rather than chase a moving target with a
  // floating tooltip, tapping just lights up that bar and posts the
  // count in a fixed readout above the chart. Clears on its own after a
  // few seconds, or immediately if you tap the same bar again.
  const [activeBar, setActiveBar] = useState(null); // { index, count } | null
  useEffect(() => {
    if (activeBar === null) return undefined;
    const t = setTimeout(() => setActiveBar(null), 4000);
    return () => clearTimeout(t);
  }, [activeBar]);

  function handleBarTap(i) {
    setActiveBar((prev) => (prev && prev.index === i ? null : { index: i, count: counts[i] }));
  }

  function renderBars(prefix) {
    return heights.map((h, i) => (
      <div
        key={`${prefix}-${i}`}
        className={`am-bar ${activeBar && activeBar.index === i ? 'am-bar-active' : ''}`}
        style={{ height: `${h}%` }}
        onClick={() => handleBarTap(i)}
      />
    ));
  }

  return (
    <div className="am-chart-live">
      <div className={`am-chart-tap-readout ${activeBar ? 'am-chart-tap-readout-visible' : ''}`}>
        {activeBar ? (activeBar.count === 1 ? 'زيارة واحدة' : `${activeBar.count} زيارة`) : ''}
      </div>
      {cycleSeconds ? (
        <div className="am-chart-strip" style={stripStyle}>
          {renderBars('a')}
          {renderBars('b')}
        </div>
      ) : (
        // Frozen ("إلى الأبد"): a plain, non-looping bar row instead of
        // the doubled-up scrolling strip — no animation to pause mid-way
        // through, no doubled DOM for no reason.
        <div className="am-chart-strip am-chart-strip-static" style={{ gap }}>
          {renderBars('static')}
        </div>
      )}
    </div>
  );
}


// Per-post drill-down opened by tapping a views number: a daily chart plus
// the exact date+time (to the minute) of every recorded view in the
// selected range. `timestamps` is that post's own epoch-ms array from
// viewsByKey — no fetch, this just re-slices data the page already has.
function ViewDetailsModal({ post, timestamps, onClose }) {
  const [detailRange, setDetailRange] = useState('28d');
  const selected = DETAIL_RANGE_OPTIONS.find((o) => o.value === detailRange) || DETAIL_RANGE_OPTIONS[1];
  const nowTs = Date.now();
  const sinceTs = selected.ms
    ? nowTs - selected.ms
    : (timestamps.length ? Math.min(...timestamps) : nowTs);

  const inRange = useMemo(
    () => timestamps.filter((t) => t >= sinceTs && t <= nowTs).sort((a, b) => b - a),
    [timestamps, sinceTs, nowTs]
  );
  const bars = useMemo(
    () => toBarHeights(bucketCounts(inRange, sinceTs, nowTs, 30)),
    [inRange, sinceTs, nowTs]
  );

  const sinceLabel = selected.ms ? `منذ ${selected.label}` : 'منذ البداية';
  const VISIBLE_LIMIT = 50;
  const visibleEvents = inRange.slice(0, VISIBLE_LIMIT);
  const hiddenCount = inRange.length - visibleEvents.length;

  return (
    <div className="am-help-modal" dir="rtl" onClick={onClose}>
      <div className="am-help-modal-content am-vd-modal" onClick={(e) => e.stopPropagation()}>
        <button className="am-help-modal-close" onClick={onClose} aria-label="إغلاق">
          <i className="fas fa-times" />
        </button>

        <div className="am-vd-header">
          <img src={post.thumbnail_url} className="am-vd-thumb" alt={post.title || post.name} />
          <h3 className="am-vd-title">{post.title || post.name}</h3>
        </div>

        <div className="am-vd-range-tabs">
          {DETAIL_RANGE_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`am-vd-range-tab ${detailRange === o.value ? 'active' : ''}`}
              onClick={() => setDetailRange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="am-chart-box">
          {bars.map((h, i) => (
            <div className="am-bar" key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="am-chart-labels">
          <span>{sinceLabel}</span>
          <span>الآن</span>
        </div>

        <div className="am-vd-total">
          <b>{inRange.length}</b> مشاهدة في هذه الفترة
        </div>

        <div className="am-vd-events">
          {visibleEvents.length === 0 ? (
            <div className="empty-state">لا توجد مشاهدات في هذه الفترة.</div>
          ) : (
            visibleEvents.map((ts, i) => (
              <div className="am-vd-event-row" key={`${ts}-${i}`}>
                <i className="fas fa-eye am-vd-event-icon" />
                <span className="mono am-vd-event-time">{absoluteDateTimeAr(ts)}</span>
              </div>
            ))
          )}
          {hiddenCount > 0 && <div className="am-vd-more">و {hiddenCount} مشاهدة أخرى…</div>}
        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  let posts = [];
  try {
    posts = await listPosts();
  } catch (err) {
    console.error('تعذر جلب المنشورات من قاعدة بيانات الموقع:', err.message);
  }
  let views = [];
  try {
    views = await listPostViews();
  } catch (err) {
    console.error('تعذر جلب سجل توقيتات المشاهدات من قاعدة بيانات الموقع:', err.message);
  }
  let visits = [];
  try {
    visits = await listSiteVisits();
  } catch (err) {
    console.error('تعذر جلب سجل زيارات الموقع من قاعدة بيانات الموقع:', err.message);
  }
  return { props: { session, posts, views, visits } };
}

export default function AnimeStatistics({ session, posts: initialPosts, views: initialViews, visits: initialVisits }) {
  const [activeView, setActiveView] = useState('website'); // 'website' | 'posts'
  const [range, setRange] = useState('48h');
  const [detailsPost, setDetailsPost] = useState(null);
  const [liveStatus, setLiveStatus] = useState(
    SITE_SUPABASE_URL && SITE_SUPABASE_ANON_KEY ? 'connecting' : 'no-config'
  );
  const posts = useMemo(() => initialPosts || [], [initialPosts]);
  const [views, setViews] = useState(initialViews || []);
  const [visits, setVisits] = useState(initialVisits || []);

  // Real push, not a refresh loop: subscribes to Supabase Realtime and gets
  // every new row the instant the site writes it — no interval, no delay.
  // The fetch-based catch-up is only a safety net for the moments a poll
  // *would* have covered anyway (tab was backgrounded, socket had to
  // reconnect), not the primary way events arrive here.
  useEffect(() => {
    let cancelled = false;

    let lastSyncOk = false;
    let updateConnectionStatus = () => {};
    let offlineTimer = null;

    async function catchUp() {
      try {
        const [viewsRes, visitsRes] = await Promise.all([
          fetch('/api/content/post-views'),
          fetch('/api/content/site-visits'),
        ]);
        const viewsData = await viewsRes.json();
        const visitsData = await visitsRes.json();
        const viewsOk = viewsRes.ok && Array.isArray(viewsData.views);
        const visitsOk = visitsRes.ok && Array.isArray(visitsData.visits);
        if (!cancelled && viewsOk) setViews(viewsData.views);
        if (!cancelled && visitsOk) setVisits(visitsData.visits);
        if (!cancelled && (viewsOk || visitsOk)) {
          // A successful server sync is a working live-data path even when
          // one Realtime channel is temporarily unavailable.
          lastSyncOk = true;
          updateConnectionStatus();
        }
        return viewsOk || visitsOk;
      } catch (err) {
        if (!cancelled) {
          lastSyncOk = false;
          if (typeof updateConnectionStatus === 'function') updateConnectionStatus();
        }
        return false;
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') catchUp();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    let viewsChannel;
    let visitsChannel;
    if (SITE_SUPABASE_URL && SITE_SUPABASE_ANON_KEY) {
      const supabase = createClient(SITE_SUPABASE_URL, SITE_SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 10 } },
      });
      const channelStatuses = { views: 'CONNECTING', visits: 'CONNECTING' };
      // Momentary websocket blips (a reconnect that resolves in a second or
      // two) shouldn't flash the red banner. Only show "offline" if the
      // bad state is still there after this grace window; recovering to
      // "live" is never delayed.
      const OFFLINE_GRACE_MS = 4000;

      // Supabase Realtime reconnects its websocket after transient network
      // failures. Keep the UI status tied to both channels and re-fetch the
      // missed rows whenever either channel becomes subscribed again; this
      // closes the gap that previously left the banner stuck on "offline".
      updateConnectionStatus = function updateConnectionStatus() {
        if (cancelled) return;
        const statuses = Object.values(channelStatuses);
        const isHealthy = statuses.some((status) => status === 'SUBSCRIBED') || lastSyncOk;
        const isBroken = !isHealthy && statuses.some((status) => ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status));

        if (isHealthy) {
          if (offlineTimer) {
            clearTimeout(offlineTimer);
            offlineTimer = null;
          }
          setLiveStatus('live');
        } else if (isBroken) {
          if (!offlineTimer) {
            offlineTimer = setTimeout(() => {
              offlineTimer = null;
              if (!cancelled) setLiveStatus('offline-connection');
            }, OFFLINE_GRACE_MS);
          }
        } else {
          if (offlineTimer) {
            clearTimeout(offlineTimer);
            offlineTimer = null;
          }
          setLiveStatus('connecting');
        }
      }

      function handleChannelStatus(kind, status) {
        channelStatuses[kind] = status;
        if (status === 'SUBSCRIBED') catchUp();
        updateConnectionStatus();
      }

      viewsChannel = supabase
        .channel('post_views_live')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'post_views' },
          (payload) => {
            if (!payload.new || cancelled) return;
            setViews((prev) => [{ post_id: payload.new.post_id, created_at: payload.new.created_at }, ...prev]);
          }
        )
        .subscribe((status) => handleChannelStatus('views', status));

      visitsChannel = supabase
        .channel('site_visits_live')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'site_visits' },
          (payload) => {
            if (!payload.new || cancelled) return;
            setVisits((prev) => [payload.new, ...prev]);
          }
        )
        .subscribe((status) => handleChannelStatus('visits', status));
    } else {
      // Not configured — fall back to at least updating on tab refocus.
      catchUp();
    }

    // Keep a short catch-up interval as a recovery path for browsers or
    // deployments where Realtime cannot stay subscribed. Realtime remains
    // the primary instant path; this prevents the UI from waiting for a
    // page reload when the socket is interrupted.
    const syncTimer = setInterval(catchUp, 15000);

    return () => {
      cancelled = true;
      clearInterval(syncTimer);
      if (offlineTimer) clearTimeout(offlineTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (viewsChannel) viewsChannel.unsubscribe();
      if (visitsChannel) visitsChannel.unsubscribe();
    };
  }, []);

  const selectedRange = RANGE_OPTIONS.find((o) => o.value === range) || RANGE_OPTIONS[0];

  // Every recorded post-view, as an epoch-ms number, regardless of which
  // post (or no-longer-existing post) it belongs to.
  const allTimestamps = useMemo(
    () => views.map((v) => new Date(v.created_at).getTime()).filter((t) => Number.isFinite(t)),
    [views]
  );

  // Same views, grouped by the key the site actually records them under
  // (post_id = the post's thumbnail_url — see lib/siteDb.js). Falls back
  // to matching on posts.id too, in case that's ever how a view gets
  // logged in the future.
  const viewsByKey = useMemo(() => {
    const map = new Map();
    for (const v of views) {
      const ts = new Date(v.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      if (!map.has(v.post_id)) map.set(v.post_id, []);
      map.get(v.post_id).push(ts);
    }
    return map;
  }, [views]);

  function timestampsForPost(post) {
    return viewsByKey.get(post.thumbnail_url) || viewsByKey.get(post.id) || [];
  }

  // Site visits (one row per NEW session — see trackSiteVisit() on the
  // public site) with everything the "الموقع" tab needs: parsed epoch ms
  // plus the raw country/referrer/os/browser/language/ip_hash fields the
  // breakdown + recent-activity sections group by. Already newest-first
  // (the initial fetch orders by created_at desc, and realtime inserts
  // get prepended), so this doubles as the feed for "النشاط الأخير".
  const visitRows = useMemo(
    () => (visits || [])
      .map((v) => ({ ...v, ts: new Date(v.created_at).getTime() }))
      .filter((v) => Number.isFinite(v.ts)),
    [visits]
  );
  const visitTimestamps = useMemo(() => visitRows.map((v) => v.ts), [visitRows]);

  // Post-view window (drives "أفضل حلقات الأنمي أداءً") and site-visit
  // window (drives the main chart + breakdowns) are kept separate so
  // picking "إلى الأبد" doesn't cut post-view history down to only what's
  // happened since site_visits started being recorded.
  //
  // nowTs is deliberately NOT memoized on [selectedRange, allTimestamps]
  // (as it originally was) — that tied "now" to post-view changes only,
  // so a fresh site visit arriving with no accompanying post view left
  // nowTs frozen at its last post-view-triggered value. Since the new
  // visit's timestamp is newer than that frozen nowTs, the v.ts <= nowTs
  // check below silently dropped it from visitsInRange — the row really
  // landed in `visits`, the number just never reflected it. Recomputing
  // nowTs on every render (React re-renders on every setViews/setVisits
  // push already) keeps both windows honest regardless of which table
  // just changed.
  const nowTs = Date.now();
  const sincePostTs = selectedRange.ms
    ? nowTs - selectedRange.ms
    : (allTimestamps.length ? Math.min(...allTimestamps) : nowTs);
  const sinceVisitTs = selectedRange.ms
    ? nowTs - selectedRange.ms
    : (visitTimestamps.length ? Math.min(...visitTimestamps) : nowTs);

  const visitsInRange = useMemo(
    () => visitRows.filter((v) => v.ts >= sinceVisitTs && v.ts <= nowTs),
    [visitRows, sinceVisitTs, nowTs]
  );

  // Total visits = one per session (real traffic). Unique visitors = distinct
  // ip_hash within the same window — the "زوار فريدون" secondary stat, since
  // one person can rack up more than one session in a given range.
  const totalVisits = visitsInRange.length;
  const uniqueVisitorsInRange = useMemo(
    () => new Set(visitsInRange.map((v) => v.ip_hash).filter(Boolean)).size,
    [visitsInRange]
  );

  const barCounts = useMemo(
    () => bucketCounts(visitsInRange.map((v) => v.ts), sinceVisitTs, nowTs, selectedRange.buckets),
    [visitsInRange, sinceVisitTs, nowTs, selectedRange]
  );
  const bars = useMemo(() => toBarHeights(barCounts), [barCounts]);

  const countryBreakdown = useMemo(() => topCountryCounts(visitsInRange), [visitsInRange]);
  const referrerBreakdown = useMemo(
    () => topCounts(visitsInRange, (v) => normalizeReferrerLabel(v.referrer)),
    [visitsInRange]
  );
  const platformBreakdown = useMemo(
    () => topCounts(visitsInRange, (v) => normalizePlatformName(v.os, v.browser)),
    [visitsInRange]
  );
  const browserBreakdown = useMemo(
    () => topCounts(visitsInRange, (v) => normalizeBrowserName(v.browser)),
    [visitsInRange]
  );
  const languageBreakdown = useMemo(
    () => topCounts(visitsInRange, (v) => normalizeLanguageName(v.language)),
    [visitsInRange]
  );

  // Always the most recent sessions regardless of the range dropdown —
  // "recent activity" reads as "right now", not "within the selected window".
  const recentActivity = useMemo(() => visitRows.slice(0, 8), [visitRows]);

  const topPosts = useMemo(() => {
    return posts
      .map((p) => {
        const postTs = timestampsForPost(p).filter((t) => t >= sincePostTs && t <= nowTs);
        return {
          ...p,
          rangeViews: postTs.length,
          mini: toBarHeights(bucketCounts(postTs, sincePostTs, nowTs, 15)),
        };
      })
      .filter((p) => p.rangeViews > 0) // hide posts nobody has watched in this range
      .sort((a, b) => b.rangeViews - a.rangeViews)
      .slice(0, 5);
  }, [posts, viewsByKey, sincePostTs, nowTs]);

  // Full inventory for the "المنشورات" tab — every post regardless of
  // views (unlike topPosts, nothing gets hidden here), ranked by
  // all-time views (not limited to the selected range, since this tab
  // has no range dropdown of its own).
  const allPostsByViews = useMemo(() => {
    return posts
      .map((p) => ({ ...p, totalViews: timestampsForPost(p).length }))
      .sort((a, b) => b.totalViews - a.totalViews);
  }, [posts, viewsByKey]);

  return (
    <Layout title="إحصائيات الأنمي" session={session}>
      <div dir="rtl" className="am-panel am-analytics">
        <div className="am-view-tabs-row">
          <div className="am-view-tabs">
            <button
              className={`am-view-tab ${activeView === 'website' ? 'active' : ''}`}
              onClick={() => setActiveView('website')}
            >
              الموقع
            </button>
            <button
              className={`am-view-tab ${activeView === 'posts' ? 'active' : ''}`}
              onClick={() => setActiveView('posts')}
            >
              المنشورات
            </button>
          </div>

          {activeView === 'website' && (
            <Dropdown
              className="am-range-dropdown"
              value={range}
              onChange={setRange}
              options={RANGE_OPTIONS}
            />
          )}
        </div>

        <div className="am-live-status">
          <span className={`am-live-dot am-live-dot-${liveStatus}`} />
          {liveStatus === 'live' && 'بث مباشر متصل — الأرقام بتتحدث لحظيًا'}
          {liveStatus === 'connecting' && 'جاري الاتصال بالبث المباشر…'}
          {liveStatus === 'offline-connection' && 'انقطع اتصال البث مؤقتًا — جاري إعادة الاتصال ومزامنة الأرقام تلقائيًا…'}
          {liveStatus === 'no-config' &&
            'البث المباشر مش شغال في هذا الديبلوي — متغيرات NEXT_PUBLIC_SITE_SUPABASE_URL / NEXT_PUBLIC_SITE_SUPABASE_ANON_KEY مش واصلة للكود المنشور (ضيفهم في Vercel واعمل Redeploy)'}
        </div>

        {activeView === 'website' ? (
          <>
            <div className="am-main-metric">
              <h1 className="am-main-number"><Ticker value={totalVisits} /></h1>
              <div className="am-main-label">إجمالي الزيارات</div>
            </div>

            <div className="am-stat-row">
              <div className="am-sub-stat">
                <div className="am-sub-number"><Ticker value={uniqueVisitorsInRange} /></div>
                <div className="am-sub-label">زوار فريدون</div>
              </div>
            </div>

            <LiveSlidingChart heights={bars} counts={barCounts} rangeMs={selectedRange.ms} />
            <div className="am-chart-labels">
              <span>{selectedRange.since}</span>
              <span>الآن</span>
            </div>

            <div className="card">
              <h2 className="am-top-title">توزيع الزوار</h2>
              {visitsInRange.length === 0 ? (
                <div className="empty-state">لسه مفيش زيارات مسجّلة في الفترة دي.</div>
              ) : (
                <>
                  <div className="am-breakdown-block">
                    <h3 className="am-breakdown-title">الدول</h3>
                    {countryBreakdown.map((row) => (
                      <div className="am-breakdown-row" key={row.label}>
                        <span className="am-breakdown-icon am-flag">{countryFlagEmoji(row.code)}</span>
                        <span className="am-breakdown-label">{row.label}</span>
                        <span className="am-breakdown-track">
                          <span className="am-breakdown-fill" style={{ width: `${row.pct}%` }} />
                        </span>
                        <span className="am-breakdown-count">{row.count}</span>
                      </div>
                    ))}
                  </div>

                  <div className="am-breakdown-block">
                    <h3 className="am-breakdown-title">مصدر الزيارة</h3>
                    {referrerBreakdown.map((row) => (
                      <div className="am-breakdown-row" key={row.label}>
                        <i className="fas fa-link am-breakdown-icon" />
                        <span className="am-breakdown-label">{row.label}</span>
                        <span className="am-breakdown-track">
                          <span className="am-breakdown-fill" style={{ width: `${row.pct}%` }} />
                        </span>
                        <span className="am-breakdown-count">{row.count}</span>
                      </div>
                    ))}
                  </div>

                  <div className="am-breakdown-block">
                    <h3 className="am-breakdown-title">الأجهزة</h3>
                    {platformBreakdown.map((row) => (
                      <div className="am-breakdown-row" key={row.label}>
                        <i className={`${platformIconClass(row.label)} am-breakdown-icon`} />
                        <span className="am-breakdown-label">{row.label}</span>
                        <span className="am-breakdown-track">
                          <span className="am-breakdown-fill" style={{ width: `${row.pct}%` }} />
                        </span>
                        <span className="am-breakdown-count">{row.count}</span>
                      </div>
                    ))}
                  </div>

                  <div className="am-breakdown-block">
                    <h3 className="am-breakdown-title">المتصفحات</h3>
                    {browserBreakdown.map((row) => (
                      <div className="am-breakdown-row" key={row.label}>
                        <i className={`${browserIconClass(row.label)} am-breakdown-icon`} />
                        <span className="am-breakdown-label">{row.label}</span>
                        <span className="am-breakdown-track">
                          <span className="am-breakdown-fill" style={{ width: `${row.pct}%` }} />
                        </span>
                        <span className="am-breakdown-count">{row.count}</span>
                      </div>
                    ))}
                  </div>

                  <div className="am-breakdown-block">
                    <h3 className="am-breakdown-title">اللغات</h3>
                    {languageBreakdown.map((row) => (
                      <div className="am-breakdown-row" key={row.label}>
                        <i className="fas fa-language am-breakdown-icon" />
                        <span className="am-breakdown-label">{row.label}</span>
                        <span className="am-breakdown-track">
                          <span className="am-breakdown-fill" style={{ width: `${row.pct}%` }} />
                        </span>
                        <span className="am-breakdown-count">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <h2 className="am-top-title">النشاط الأخير</h2>
              {recentActivity.length === 0 ? (
                <div className="empty-state">لسه مفيش نشاط مسجّل.</div>
              ) : (
                recentActivity.map((v, i) => {
                  const platform = normalizePlatformName(v.os, v.browser);
                  const browser = normalizeBrowserName(v.browser);
                  const location = [v.city, v.region, v.country].filter(Boolean).join('، ') || 'غير معروف';
                  return (
                    <div className="am-activity-item" key={`${v.session_id || v.created_at}-${i}`}>
                      <div className="am-activity-top">
                        <span className="am-flag">{countryFlagEmoji(v.country_code)}</span>
                        <b>{location}</b>
                        <span className="am-activity-time">{relativeTimeAr(v.ts)}</span>
                      </div>
                      <div className="am-activity-sub">
                        <i className={platformIconClass(platform)} /> {platform}
                        {' · '}
                        <i className={browserIconClass(browser)} /> {browser}
                        {' · '}
                        {normalizeReferrerLabel(v.referrer)}
                        {' · '}
                        {normalizeLanguageName(v.language)}
                        {v.ip && (
                          <>
                            {' · '}
                            <span className="mono">{v.ip}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="card">
              <h2 className="am-top-title">أفضل حلقات الأنمي أداءً</h2>
              {topPosts.length === 0 ? (
                <div className="empty-state">لسه محدش شاهد أي منشور في الفترة دي.</div>
              ) : (
                topPosts.map((post) => (
                  <div className="am-vid-item" key={post.id}>
                    <img src={post.thumbnail_url} className="am-vid-thumb" alt={post.title} />
                    <div className="am-vid-info">
                      <div className="am-vid-title">{post.title || post.name}</div>
                    </div>
                    <div className="am-vid-stats">
                      <button
                        type="button"
                        className="am-vid-views am-vid-views-btn"
                        onClick={() => setDetailsPost(post)}
                      >
                        <Ticker value={post.rangeViews} />
                      </button>
                      <div className="am-mini-chart">
                        {post.mini.map((h, i) => (
                          <div className="am-mini-bar" key={i} style={{ height: `${h}%` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="card">
            <h2 className="am-top-title">كل المنشورات ({allPostsByViews.length})</h2>
            {allPostsByViews.length === 0 ? (
              <div className="empty-state">لسه مفيش منشورات.</div>
            ) : (
              allPostsByViews.map((post) => {
                const typeInfo = POST_TYPES.find((t) => t.value === post.type);
                return (
                  <div className="am-vid-item" key={post.id}>
                    <img src={post.thumbnail_url} className="am-vid-thumb" alt={post.title || post.name} />
                    <div className="am-vid-info">
                      <div className="am-vid-title">{post.title || post.name}</div>
                      {typeInfo && (
                        <div className="am-post-type-badge">
                          <i className={`fas ${typeInfo.icon}`} /> {typeInfo.label}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="am-vid-views am-vid-views-btn"
                      onClick={() => setDetailsPost(post)}
                    >
                      <Ticker value={post.totalViews} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {detailsPost && (
        <ViewDetailsModal
          post={detailsPost}
          timestamps={timestampsForPost(detailsPost)}
          onClose={() => setDetailsPost(null)}
        />
      )}
    </Layout>
  );
}
