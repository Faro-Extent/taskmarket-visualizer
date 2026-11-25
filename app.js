// Taskmarket Live — renders data/*.json (fetched server-side, hourly) into the page.
// No API calls from the browser. No wallet. No tracking.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const fmtUsd = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const fmtUsd2 = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const usd = (baseUnits) => Number(baseUnits || 0) / 1e6;
const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function left(ts) {
  const s = (new Date(ts).getTime() - Date.now()) / 1000;
  if (s <= 0) return 'closed';
  if (s < 3600) return Math.floor(s / 60) + 'm left';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm left';
  return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h left';
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

const state = { chain: 4217, range: '30d', metric: 'activeAgents' };
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('chain') === '8453' || h.get('chain') === '4217') state.chain = +h.get('chain');
  if (['7d', '30d', '90d', 'all'].includes(h.get('range'))) state.range = h.get('range');
  if (['activeAgents', 'tasksCreated', 'rewardVolume', 'paidVolume'].includes(h.get('metric'))) state.metric = h.get('metric');
}
function writeHash() {
  history.replaceState(null, '', `#chain=${state.chain}&range=${state.range}&metric=${state.metric}`);
}

let DATA = {}; // chainId -> json
let META = {};

async function load() {
  const [tempo, base, meta] = await Promise.all([
    fetch('data/tempo.json').then((r) => r.json()),
    fetch('data/base.json').then((r) => r.json()),
    fetch('data/meta.json').then((r) => r.json()),
  ]);
  DATA = { 4217: tempo, 8453: base };
  META = meta;
}

function chainData() { return DATA[state.chain]; }
function otherChainData() { return DATA[state.chain === 4217 ? 8453 : 4217]; }

function renderHeadlines() {
  const d = chainData();
  const m = d.market;
  const series30 = d.series['30d'] || [];
  const paid30 = series30.reduce((s, b) => s + usd(b.paidVolume), 0);
  const tasks30 = series30.reduce((s, b) => s + (b.tasksCreated || 0), 0);
  $('#headlines').innerHTML = [
    [fmtInt(m.registeredWorkers), 'Registered workers', 'platform-wide'],
    [fmtInt(m.activeAgents7d), 'Active agents · 7d', 'platform-wide'],
    [fmtInt(m.openTasks), 'Open tasks', 'platform-wide'],
    [fmtInt(m.paidWorkers), 'Workers paid', 'platform-wide'],
    [fmtUsd(paid30), 'Rewards paid · 30d', 'platform-wide'],
    [fmtInt(tasks30), 'Tasks posted · 30d', 'platform-wide'],
  ].map(([n, l, s]) => `<div class="card"><div class="label">${l}</div><div class="num">${n}</div><div class="sub">${s}</div></div>`).join('');
}

function renderFlow() {
  const d = chainData();
  const rows = d.series[state.range] || [];
  const putUp = rows.reduce((s, b) => s + usd(b.rewardVolume), 0);
  const paid = rows.reduce((s, b) => s + usd(b.paidVolume), 0);
  const settlements = rows.reduce((s, b) => s + (b.settlements || 0), 0);
  const completed = rows.reduce((s, b) => s + (b.completedTasks || 0), 0);
  const max = Math.max(putUp, paid, 1);
  const pct = putUp ? Math.round((paid / putUp) * 100) : 0;
  const bar = (v, cls) => `<div class="fbar ${cls}"><i style="width:${Math.max(1.5, (v / max) * 100)}%"></i></div>`;
  $('#flowbox').innerHTML = `
    <div class="flowrow"><div class="fname">Rewards put up</div>${bar(putUp, '')}<div class="fval">${fmtUsd(putUp)}</div></div>
    <div class="flowrow"><div class="fname">Rewards paid <span class="muted small">(${pct}% of put up)</span></div>${bar(paid, 'paid')}<div class="fval">${fmtUsd(paid)}</div></div>
    <div class="flowrow"><div class="fname">Settlements</div>${bar(settlements, 'settled')}<div class="fval">${fmtInt(settlements)}</div></div>
    <div class="flowrow"><div class="fname">Tasks completed</div>${bar(completed, 'settled')}<div class="fval">${fmtInt(completed)}</div></div>
    <p class="small muted" style="margin:14px 0 0">Range: ${state.range}. ${fmtUsd(putUp - paid)} of rewards put up in this range is still in flight — posted, not yet paid out.</p>`;
}

const METRIC_LABEL = {
  activeAgents: ['Active agents', (v) => fmtInt(v)],
  tasksCreated: ['Tasks posted', (v) => fmtInt(v)],
  rewardVolume: ['Rewards put up ($)', (v) => fmtUsd(v)],
  paidVolume: ['Rewards paid ($)', (v) => fmtUsd(v)],
};

function renderChart() {
  const d = chainData();
  const rows = (d.series[state.range] || []).slice();
  const fmt = METRIC_LABEL[state.metric][1];
  const vals = rows.map((b) => (state.metric === 'rewardVolume' || state.metric === 'paidVolume' ? usd(b[state.metric]) : b[state.metric] || 0));
  const W = 1000, H = 300, PL = 64, PR = 16, PT = 18, PB = 28;
  const max = Math.max(...vals, 1);
  const x = (i) => PL + ((W - PL - PR) * i) / Math.max(rows.length - 1, 1);
  const y = (v) => PT + (H - PT - PB) * (1 - v / max);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `M${x(0)},${y(0)} ` + vals.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ` L${x(vals.length - 1)},${H - PB} L${x(0)},${H - PB} Z`;
  const ticks = [0, 0.5, 1].map((f) => {
    const v = max * f;
    return `<line class="gridline" x1="${PL}" y1="${y(v)}" x2="${W - PR}" y2="${y(v)}"/><text class="axis" x="${PL - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }).join('');
  const first = rows[0]?.bucket || '', last = rows[rows.length - 1]?.bucket || '';
  const mid = rows[Math.floor(rows.length / 2)]?.bucket || '';
  $('#chart').innerHTML = `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${METRIC_LABEL[state.metric][0]} over time, ${state.range}">
      ${ticks}
      <path class="area" d="${area}"/>
      <polyline class="linepath" points="${pts}"/>
      <text class="axis" x="${PL}" y="${H - 6}">${first}</text>
      <text class="axis" x="${W / 2}" y="${H - 6}" text-anchor="middle">${mid}</text>
      <text class="axis" x="${W - PR}" y="${H - 6}" text-anchor="end">${last}</text>
    </svg>`;
  const total = vals.reduce((s, v) => s + v, 0);
  const peak = rows[vals.indexOf(Math.max(...vals))];
  $('#chartfoot').textContent = `${METRIC_LABEL[state.metric][0]} · ${state.range}: total ${fmt(total)} · peak ${fmt(Math.max(...vals))} on ${peak?.bucket || '—'} · ${rows.length} days.`;
}

function barRows(items, valueFmt, alt) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return items.map((i) => `
    <div class="barrow"><div>${esc(i.label)}</div>
    <div class="track"><i class="${alt ? 'alt' : ''}" style="width:${Math.max(1, (i.value / max) * 100)}%"></i></div>
    <div class="v">${valueFmt(i.value)}</div></div>`).join('');
}

function renderBreakdown() {
  const d = chainData();
  const byMode = [...(d.breakdowns.mode || [])].sort((a, b) => b.count - a.count)
    .map((m) => ({ label: m.mode, value: m.count }));
  const byStatus = [...(d.breakdowns.status || [])].sort((a, b) => b.count - a.count)
    .map((s) => ({ label: s.status.replace(/_/g, ' '), value: s.count }));
  $('#bymode').innerHTML = barRows(byMode, fmtInt, false);
  $('#bystatus').innerHTML = barRows(byStatus, fmtInt, true);
}

function renderPosters() {
  const d = chainData();
  const weeks = d.derived.postersPerWeek || [];
  const max = Math.max(...weeks.map((w) => w.distinctPosters), 1);
  $('#postersweek').innerHTML = weeks.map((w) => `
    <div class="barrow"><div class="mono small">w/c ${w.week}</div>
    <div class="track"><i style="width:${Math.max(2, (w.distinctPosters / max) * 100)}%"></i></div>
    <div class="v">${w.distinctPosters}</div></div>`).join('') ||
    '<p class="muted small">No poster data in this range.</p>';
  const top = (d.derived.topPosters || []).slice(0, 8);
  const tmax = Math.max(...top.map((t) => t.tasks), 1);
  $('#topposters').innerHTML = top.map((t) => `
    <div class="barrow"><div class="mono small">${shortAddr(t.address)}</div>
    <div class="track"><i class="alt" style="width:${Math.max(2, (t.tasks / tmax) * 100)}%"></i></div>
    <div class="v">${t.tasks}</div></div>`).join('');
}

function heatColor(v, max) {
  // magenta scale on the dark panel
  const t = max ? v / max : 0;
  if (t <= 0) return '#221E1A';
  const r = Math.round(0x3a + (0xe7 - 0x3a) * t);
  const g = Math.round(0x14 + (0x40 - 0x14) * t);
  const b = Math.round(0x20 + (0x79 - 0x20) * t);
  return `rgb(${r},${g},${b})`;
}

function renderHeatmaps() {
  const d = chainData();
  const hm = d.heatmapMode || {};
  const maxM = Math.max(...(hm.cells || []).map((c) => c.count || 0), 1);
  const cellMap = new Map((hm.cells || []).map((c) => [`${c.row}|${c.col}`, c.count || 0]));
  const cols = hm.colKeys || [];
  const rows = hm.rowKeys || [];
  $('#heatmapmode').innerHTML = rows.map((r) => `
    <div style="display:grid;grid-template-columns:74px 1fr;gap:8px;align-items:center;margin-bottom:2px">
      <div class="small muted">${esc(r)}</div>
      <div class="heat" style="grid-template-columns:repeat(${cols.length},1fr)">
        ${cols.map((c) => { const v = cellMap.get(`${r}|${c}`) || 0; return `<div class="cell" title="${esc(r)} · ${c}: ${v} tasks" style="background:${heatColor(v, maxM)}"></div>`; }).join('')}
      </div>
    </div>`).join('') +
    `<div class="legend" style="margin-top:10px"><span>Less</span><i style="background:#221E1A"></i><i style="background:#7d2c46"></i><i style="background:#b2345f"></i><i style="background:#E74079"></i><span>More</span><span class="muted">· counts = tasks, per day</span></div>`;

  const hh = d.heatmapHour || {};
  const maxH = Math.max(...(hh.cells || []).map((c) => c.count || 0), 1);
  const hMap = new Map((hh.cells || []).map((c) => [`${c.row}|${c.col}`, c.count || 0]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hcols = hh.colKeys || [...Array(24).keys()].map(String);
  $('#heat-hour').innerHTML = (hh.rowKeys || []).map((r, i) => `
    <div style="display:grid;grid-template-columns:34px 1fr;gap:8px;align-items:center;margin-bottom:2px">
      <div class="small muted">${days[+r] ?? r}</div>
      <div class="heat hour" style="grid-template-columns:repeat(${hcols.length},1fr)">
        ${hcols.map((c) => { const v = hMap.get(`${r}|${c}`) || 0; return `<div class="cell" title="${days[+r] ?? r} ${c}:00 UTC: ${v}" style="background:${heatColor(v, maxH)}"></div>`; }).join('')}
      </div>
    </div>`).join('') +
    `<div class="legend" style="margin-top:10px"><span>Less</span><i style="background:#221E1A"></i><i style="background:#7d2c46"></i><i style="background:#b2345f"></i><i style="background:#E74079"></i><span>More</span><span class="muted">· UTC hours</span></div>`;
}

function renderInsights() {
  const d = chainData();
  const dv = d.derived;
  const growth = dv.growth7dPct == null ? 'no prior week to compare'
    : `${dv.growth7dPct > 0 ? '+' : ''}${dv.growth7dPct}% vs the previous 7 days`;
  $('#insightgrid').innerHTML = [
    [`<b><em>${dv.top5PosterSharePct}%</em> of tasks</b>`, `come from the top 5 posters on ${state.chain === 4217 ? 'Tempo' : 'Base'}. A handful of wallets set the agenda — new posters are a small share of the flow.`],
    [`<b><em>${dv.diedShare}%</em> died</b>`, `of listed tasks expired or were cancelled without a winner. On ${state.chain === 4217 ? 'Tempo' : 'Base'}, ${fmtInt(dv.statusCounts.expired)} expired and ${fmtInt(dv.statusCounts.cancelled)} were cancelled.`],
    [`<b>Tasks are <em>${growth}</em></b>`, `${fmtInt(dv.tasksLast7d)} tasks posted in the last 7 days, against ${fmtInt(dv.tasksPrev7d)} the week before. Median task window: ${dv.medianWindowHours ?? '—'} hours from posting to expiry.`],
    [`<b>Each task draws <em>${dv.avgSubmissionsPerTask}</em> entries</b>`, `on average, across listed tasks on this chain. Bounties are a swarm: many agents converge, one (or a few) get paid.`],
  ].map(([b, p]) => `<div class="panel insight">${b}<p class="small muted" style="margin:0">${p}</p></div>`).join('');
}

const FEED_LABEL = {
  task_created: 'Task posted', task_submitted: 'Submitted', task_completed: 'Completed',
  task_accepted: 'Accepted', task_cancelled: 'Cancelled', settlement: 'Paid out',
  task_claimed: 'Claimed', rating: 'Rated',
};

function renderFeed() {
  const d = chainData();
  const items = (d.feed || []).filter((f) => +f.chainId === state.chain).slice(0, 15);
  const other = (d.feed || []).filter((f) => +f.chainId !== state.chain);
  const list = items.length ? items : (d.feed || []).slice(0, 15);
  $('#feedlist').innerHTML = list.map((f) => {
    const amt = f.amount != null ? fmtUsd2(usd(f.amount)) : '';
    const label = FEED_LABEL[f.type] || f.type.replace(/_/g, ' ');
    const name = f.taskTitle ? esc(f.taskTitle.length > 90 ? f.taskTitle.slice(0, 90) + '…' : f.taskTitle) : '—';
    return `<li><span class="t">${ago(f.timestamp)}</span>
      <span><span class="kind">${esc(label)}</span> · ${name}<br>
      <span class="muted small mono">${shortAddr(f.actor)}${f.actorAgentId ? ' · agent ' + esc(f.actorAgentId) : ''} · ${+f.chainId === 4217 ? 'Tempo' : 'Base'}</span></span>
      <span class="amt">${amt}</span></li>`;
  }).join('') || '<li class="muted">No feed items for this chain yet.</li>';
}

function renderOpen() {
  const d = chainData();
  const tasks = (d.openTasks || []).slice(0, 15);
  $('#opentable').innerHTML = `<thead><tr><th>Task</th><th>Mode</th><th class="num">Reward</th><th class="num">Entries</th><th class="num">Closes</th></tr></thead><tbody>` +
    tasks.map((t) => `<tr>
      <td><a href="https://taskmarket.dev/tasks/${t.id}" target="_blank" rel="noopener">${esc(t.title)}</a><br>
      <span class="muted small mono">${esc(t.referenceCode || '')}</span> ${t.tags.map((tag) => `<span class="tagchip">${esc(tag)}</span>`).join('')}</td>
      <td>${esc(t.mode)}</td><td class="num">${fmtUsd2(t.rewardUsd)}</td>
      <td class="num">${t.submissionCount ?? '—'}</td><td class="num">${t.expiryTime ? left(t.expiryTime) : '—'}</td>
    </tr>`).join('') + '</tbody>';
}

function renderAll() {
  const isTempo = state.chain === 4217;
  $('#chainnote').textContent = isTempo ? 'Tempo · OUSD' : 'Base · USDC';
  $('#posternote').textContent = `${isTempo ? 'Tempo' : 'Base'} · from /api/tasks`;
  $('#opennote').textContent = `${isTempo ? 'Tempo' : 'Base'} · from /api/tasks`;
  $$('[data-chain]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.chain === state.chain)));
  $$('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
  $$('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)));
  renderHeadlines();
  renderFlow();
  renderChart();
  renderBreakdown();
  renderPosters();
  renderHeatmaps();
  renderInsights();
  renderFeed();
  renderOpen();
  writeHash();
}

function bind() {
  $$('[data-chain]').forEach((b) => b.addEventListener('click', () => { state.chain = +b.dataset.chain; renderAll(); }));
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => { state.range = b.dataset.range; renderAll(); }));
  $$('[data-metric]').forEach((b) => b.addEventListener('click', () => { state.metric = b.dataset.metric; renderAll(); }));
  $('#copylink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('#copylink').textContent = 'Link copied'; }
    catch { $('#copylink').textContent = location.href; }
    setTimeout(() => { $('#copylink').textContent = 'Copy link to this view'; }, 2000);
  });
  $('#sharex').addEventListener('click', () => {
    const text = encodeURIComponent('Taskmarket, live: what is happening on the market right now.');
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(location.href)}`, '_blank');
  });
}

(async () => {
  readHash();
  bind();
  try {
    await load();
    const asof = new Date(META.fetchedAt);
    $('#asof').textContent = asof.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    $('#endpoints').innerHTML = (META.endpoints || []).map((e) => `<li><code class="mono">${esc(e)}</code></li>`).join('');
    renderAll();
  } catch (e) {
    $('#asof').textContent = 'data failed to load';
    document.body.insertAdjacentHTML('beforeend', `<p style="color:#E74079;padding:0 20px">Data could not be loaded: ${esc(e.message)}. The hourly build refreshes data/*.json — try again shortly.</p>`);
  }
})();
