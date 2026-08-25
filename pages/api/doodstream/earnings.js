const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');
const adsterra = require('../../../lib/adsterra');
const { getOrRefreshVidmolySnapshot } = require('../../../lib/vidmolyDashboardCache');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function loadEarningsFromProvider() {
  const [accountAttempt, statsAttempt, adsterraAttempt] = await Promise.allSettled([
    vidmoly.accountInfo(),
    vidmoly.accountStats({ last: 2 }),
    adsterra.getEarningsSummary(),
  ]);

  // Vidmoly and Adsterra are independent. A temporary Vidmoly quota error
  // must not discard a successful Adsterra refresh and leave the dashboard
  // permanently showing an old all-zero earnings snapshot.
  const accountRes = accountAttempt.status === 'fulfilled' ? accountAttempt.value : { result: {} };
  const statsRes = statsAttempt.status === 'fulfilled' ? statsAttempt.value : { result: [] };
  const vidmolyError = [accountAttempt, statsAttempt]
    .filter((attempt) => attempt.status === 'rejected')
    .map((attempt) => attempt.reason?.message || 'Vidmoly provider request failed')
    .join(' · ') || null;
  const adsterraResult = adsterraAttempt.status === 'fulfilled'
    ? adsterraAttempt.value
    : { error: adsterraAttempt.reason?.message || 'Adsterra provider request failed' };

  const balance = accountRes.result?.balance ?? '0';
  const days = Array.isArray(statsRes.result) ? statsRes.result : [];
  const today = days.find((d) => d.day === todayStr());
  const yesterday = days.find((d) => d.day === yesterdayStr());

    // Per-file size isn't in /file/list or /file/info (confirmed from a
    // real response — see lib/vidmoly.js / library.js), but Vidmoly's own
    // docs describe Account Info as covering "disk usage" too, so total
    // storage used is tried here instead, at the account level.
  const storageUsedRaw =
    accountRes.result?.storage_used ??
    accountRes.result?.used_space ??
    accountRes.result?.disk_used ??
    accountRes.result?.used ??
    accountRes.result?.storage ??
    null;
    // Confirmed from a real account: this field comes back in KB, not
    // bytes — a value of 552570.88 lined up exactly with a real 539.62 MB
    // library (204.96 + 334.66) once treated as KB, whereas reading it as
    // bytes (this repo's usual unit — see formatSize in pages/dashboard/
    // index.js) rendered as "539.62 KB", a factor of 1024 too small.
  const storageUsed = storageUsedRaw === null ? null : Number(storageUsedRaw) * 1024;

  const vidmolyBalance = Number.parseFloat(balance) || 0;
  const vidmolyToday = Number.parseFloat(today?.profit_total ?? 0) || 0;
  const vidmolyYesterday = Number.parseFloat(yesterday?.profit_total ?? 0) || 0;
  const adsterraEarnings = adsterraResult.error
    ? { total: 0, historicalTotal: 0, today: 0, yesterday: 0, error: adsterraResult.error }
    : adsterraResult;

  return {
    status: 200,
    result: {
      balance,
      today: (vidmolyToday + adsterraEarnings.today).toFixed(5),
      yesterday: (vidmolyYesterday + adsterraEarnings.yesterday).toFixed(5),
      // Keep the dashboard total meaningful: Vidmoly's balance plus all
      // recorded Adsterra revenue, not only the current calendar month.
      total: (vidmolyBalance + adsterraEarnings.historicalTotal).toFixed(5),
      earningsSources: {
        vidmoly: { balance: vidmolyBalance, today: vidmolyToday, yesterday: vidmolyYesterday, error: vidmolyError },
        adsterra: { total: adsterraEarnings.total, historicalTotal: adsterraEarnings.historicalTotal, today: adsterraEarnings.today, yesterday: adsterraEarnings.yesterday, error: adsterraEarnings.error || null, periodStart: adsterraEarnings.periodStart || null, periodEnd: adsterraEarnings.periodEnd || null, historyPeriodStart: adsterraEarnings.historyPeriodStart || null, historyPeriodEnd: adsterraEarnings.historyPeriodEnd || null },
      },
      storageUsed,
      // Only sent when none of the guesses above matched — same
      // screenshot-and-fix pattern as the library's debugSample.
      accountRaw: storageUsed === null ? accountRes.result : null,
    },
  };
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const force = req.query.refresh === '1' && session.role === 'admin';
    const snapshot = await getOrRefreshVidmolySnapshot('earnings', loadEarningsFromProvider, { force });
    return res.status(200).json({ ...snapshot.payload, cache: snapshot.meta });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
