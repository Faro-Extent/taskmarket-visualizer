// fetch-data.mjs — server-side fetch of Taskmarket public API data.
// Runs in GitHub Actions (hourly) and locally. No keys needed.
// Writes data/tempo.json, data/base.json and data/meta.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');
mkdirSync(OUT, { recursive: true });

const API = 'https://api.taskmarket.dev';
const CHAINS = [4217, 8453];
const RANGES = ['7d', '30d', '90d', 'all'];

async function get(path, attempt = 0) {
  const res = await fetch(API + path, { headers: { 'user-agent': 'taskmarket-visualizer/1.0 (+https://taskmarket.dev)' } });
  if (res.status === 429 && attempt < 6) {
    const wait = 2000 * (attempt + 1);
    console.log(`429 ${path} — retry ${attempt + 1} in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function getTasks(chainId) {
  // All tasks, every status, newest first. The unfiltered list caps out, so
  // paginate each status separately and dedupe by id. Cap at 4000 per chain.
  const seen = new Map();
  // The unfiltered list and the per-status lists each return a different
  // subset, so fetch both and merge by id. Cap at 4000 per chain.
  const fetchPage = async (params) => {
    let cursor = null;
    do {
      const qs = new URLSearchParams({ ...params, sort: 'newest', limit: '100' });
      if (cursor) qs.set('cursor', cursor);
      const page = await get('/api/tasks?' + qs);
      for (const t of page.tasks || []) seen.set(t.id, t);
      cursor = page.nextCursor || null;
      if (seen.size >= 4000) return;
    } while (cursor);
  };
  await fetchPage({ chainId: String(chainId) });
  const statuses = ['open', 'completed', 'expired', 'cancelled', 'claimed', 'worker_selected', 'pending_approval'];
  for (const status of statuses) {
    // eslint-disable-next-line no-await-in-loop
    await fetchPage({ chainId: String(chainId), status });
  }
  const tasks = [...seen.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return tasks;
}

function weekKey(d) {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7; // Monday start
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

function derive(tasks) {
  const byWeek = new Map(); // weekKey -> Set(requester)
  const posterCounts = new Map();
  const windows = [];
  let expired = 0, cancelled = 0, completed = 0, open = 0;
  let subs = 0, rewardSum = 0n, rewardN = 0;
  const now = Date.now();
  const weekAgo = now - 7 * 864e5, twoWeeksAgo = now - 14 * 864e5;
  let last7 = 0, prev7 = 0;

  for (const t of tasks) {
    const created = new Date(t.createdAt).getTime();
    const wk = weekKey(t.createdAt);
    if (!byWeek.has(wk)) byWeek.set(wk, new Set());
    byWeek.get(wk).add((t.requester || '').toLowerCase());
    posterCounts.set((t.requester || '').toLowerCase(), (posterCounts.get((t.requester || '').toLowerCase()) || 0) + 1);
    if (t.status === 'expired') expired++;
    if (t.status === 'cancelled') cancelled++;
    if (t.status === 'completed') completed++;
    if (t.status === 'open') open++;
    if (typeof t.submissionCount === 'number') subs += t.submissionCount;
    try { rewardSum += BigInt(t.reward || '0'); rewardN++; } catch {}
    if (t.createdAt && t.expiryTime) {
      windows.push(new Date(t.expiryTime).getTime() - created);
    }
    if (created >= weekAgo) last7++;
    else if (created >= twoWeeksAgo) prev7++;
  }

  windows.sort((a, b) => a - b);
  const medianWindowHrs = windows.length
    ? Math.round(windows[Math.floor(windows.length / 2)] / 36e5 * 10) / 10
    : null;

  const postersPerWeek = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([week, set]) => ({ week, distinctPosters: set.size }));

  const topPosters = [...posterCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([address, tasks]) => ({ address, tasks }));

  const top5Share = tasks.length
    ? Math.round(topPosters.slice(0, 5).reduce((s, p) => s + p.tasks, 0) / tasks.length * 1000) / 10
    : 0;

  return {
    totalTasks: tasks.length,
    statusCounts: { open, completed, expired, cancelled },
    diedShare: tasks.length ? Math.round((expired + cancelled) / tasks.length * 1000) / 10 : 0,
    totalSubmissions: subs,
    avgSubmissionsPerTask: tasks.length ? Math.round(subs / tasks.length * 10) / 10 : 0,
    avgRewardUsd: rewardN ? Math.round(Number(rewardSum / BigInt(rewardN)) / 1e6 * 100) / 100 : 0,
    medianWindowHours: medianWindowHrs,
    postersPerWeek,
    topPosters,
    top5PosterSharePct: top5Share,
    tasksLast7d: last7,
    tasksPrev7d: prev7,
    growth7dPct: prev7 ? Math.round((last7 - prev7) / prev7 * 1000) / 10 : null,
  };
}

async function fetchChain(chainId) {
  const [market, breakdowns, feed] = await Promise.all([
    get(`/api/market/stats?chainId=${chainId}`),
    get(`/api/stats/breakdowns?chainId=${chainId}`),
    get(`/api/stats/activity-feed?chainId=${chainId}&limit=40`),
  ]);
  const series = {};
  for (const range of RANGES) {
    series[range] = await get(
      `/api/stats/platform-time-series?chainId=${chainId}&range=${range}&bucket=day`,
    );
  }
  const heatmapMode = await get(`/api/stats/activity-heatmap?chainId=${chainId}&range=30d&dimension=mode`);
  const heatmapHour = await get(`/api/stats/activity-heatmap?chainId=${chainId}&range=30d&dimension=hourOfWeek`);
  const tasks = await getTasks(chainId);
  // Keep only the fields the dashboard needs (no long descriptions).
  const slimTasks = tasks.map((t) => ({
    id: t.id,
    referenceCode: t.referenceCode,
    title: (t.description || '').split('\n')[0].slice(0, 140),
    requester: t.requester,
    requesterDisplayName: t.requesterDisplayName || null,
    rewardUsd: Math.round(Number(t.reward || 0) / 1e6 * 100) / 100,
    mode: t.mode,
    status: t.status,
    createdAt: t.createdAt,
    expiryTime: t.expiryTime,
    submissionCount: t.submissionCount ?? null,
    tags: t.tags || [],
  }));
  return {
    chainId,
    market,
    breakdowns,
    series,
    heatmapMode,
    heatmapHour,
    feed: feed.items || feed || [],
    derived: derive(tasks),
    openTasks: slimTasks.filter((t) => t.status === 'open').slice(0, 60),
    recentTasks: slimTasks.slice(0, 30),
  };
}

const fetchedAt = new Date().toISOString();
const out = {};
for (const chainId of CHAINS) {
  // eslint-disable-next-line no-await-in-loop
  out[chainId] = await fetchChain(chainId);
  console.log('fetched chain', chainId, 'tasks:', out[chainId].derived.totalTasks);
}
writeFileSync(join(OUT, 'tempo.json'), JSON.stringify(out[4217]));
writeFileSync(join(OUT, 'base.json'), JSON.stringify(out[8453]));
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({
  fetchedAt,
  endpoints: [
    '/api/market/stats?chainId=…',
    '/api/stats/breakdowns?chainId=…',
    '/api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day',
    '/api/stats/activity-heatmap?chainId=…&range=30d&dimension=mode|hourOfWeek',
    '/api/stats/activity-feed?chainId=…&limit=40',
    '/api/tasks?chainId=…&sort=newest&limit=100 (paginated)',
  ],
  source: 'https://api.taskmarket.dev',
  refresh: 'hourly via GitHub Actions (scheduled build), cached in data/*.json',
}, null, 2));
console.log('done, fetchedAt', fetchedAt);
