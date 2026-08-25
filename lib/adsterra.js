const API_BASE = 'https://api3.adsterratools.com/publisher';
// The Publisher Statistics API does not expose an account-balance field and
// rejects broad date ranges. The dashboard therefore sums one accepted
// calendar-month request at a time from the beginning of the current year.

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function asNumber(value) {
  const number = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.stats)) return payload.stats;
  return [];
}

function revenueFromPayload(payload) {
  return rowsFromPayload(payload).reduce((sum, row) => {
    return sum + asNumber(row.revenue ?? row.earnings ?? row.profit ?? row.amount);
  }, 0);
}

async function fetchStats({ startDate, finishDate }) {
  const apiKey = process.env.ADSTERRA_API_KEY;
  if (!apiKey) throw new Error('ADSTERRA_API_KEY is not configured');

  const query = new URLSearchParams({
    start_date: startDate,
    finish_date: finishDate,
    // Required by the Publisher Statistics API. Grouping by date also
    // lets the dashboard separate today's earnings from yesterday's.
    group_by: 'date',
  });
  const response = await fetch(`${API_BASE}/stats.json?${query}`, {
    headers: {
      Accept: 'application/json',
      'X-API-Key': apiKey,
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Adsterra returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Adsterra API error ${response.status}`);
  }
  return payload;
}

async function getCurrentMonthEarnings(now = new Date()) {
  const today = dateString(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = dateString(yesterdayDate);
  const monthStart = dateString(startOfMonth(now));
  const payload = await fetchStats({ startDate: monthStart, finishDate: today });
  const rows = rowsFromPayload(payload);
  const byDay = new Map();
  for (const row of rows) {
    const day = row.date ?? row.day ?? row.stat_date ?? row.datetime;
    if (day) byDay.set(String(day).slice(0, 10), (byDay.get(String(day).slice(0, 10)) || 0) + asNumber(row.revenue ?? row.earnings ?? row.profit ?? row.amount));
  }
  return {
    total: revenueFromPayload(payload),
    today: byDay.get(today) || 0,
    yesterday: byDay.get(yesterday) || 0,
    periodStart: monthStart,
    periodEnd: today,
  };
}

async function getEarningsSummary(now = new Date()) {
  const today = dateString(now);
  const currentMonth = await getCurrentMonthEarnings(now);
  const year = now.getUTCFullYear();
  const historyPeriodStart = `${year}-01-01`;
  const monthRanges = [];

  for (let month = 0; month <= now.getUTCMonth(); month += 1) {
    const start = new Date(Date.UTC(year, month, 1));
    const end = month === now.getUTCMonth()
      ? now
      : new Date(Date.UTC(year, month + 1, 0));
    monthRanges.push({ startDate: dateString(start), finishDate: dateString(end) });
  }

  const historyPayloads = await Promise.all(monthRanges.map((range) => fetchStats(range)));
  const monthlyTotals = historyPayloads.map((payload, index) => ({
    startDate: monthRanges[index].startDate,
    finishDate: monthRanges[index].finishDate,
    revenue: revenueFromPayload(payload),
  }));
  const historicalTotal = monthlyTotals.reduce((total, month) => total + month.revenue, 0);

  return {
    ...currentMonth,
    historicalTotal,
    monthlyTotals,
    historyPeriodStart,
    historyPeriodEnd: today,
  };
}

module.exports = { getCurrentMonthEarnings, getEarningsSummary, revenueFromPayload, rowsFromPayload };
