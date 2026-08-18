const { requireAuth } = require('../../../lib/api-auth');
const vidmoly = require('../../../lib/vidmoly');
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
  const [accountRes, statsRes] = await Promise.all([
    vidmoly.accountInfo(),
    vidmoly.accountStats({ last: 2 }),
  ]);

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

  return {
    status: 200,
    result: {
      balance,
      today: today?.profit_total ?? '0.00000',
      yesterday: yesterday?.profit_total ?? '0.00000',
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
