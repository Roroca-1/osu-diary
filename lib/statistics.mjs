// Read-only statistics: one range and one set of bucket boundaries for every view.
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dayAtNoon(day) { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); }
export function bucketize(rows, metric, step) {
  const allowed = metric === 'ar' ? [0.1, 0.5] : [1, 10];
  if (!allowed.includes(step)) throw Object.assign(new Error('Unsupported bucket step'), { code: 'INVALID_BUCKET_STEP' });
  const scale = metric === 'ar' ? 10 : 1, units = step * scale, buckets = new Map();
  for (const p of rows) {
    const v = p[metric];
    if (!finite(v) || v < 0 || (metric === 'bpm' && v === 0)) continue;
    const index = Math.floor(v * scale / units);
    let b = buckets.get(index);
    if (!b) buckets.set(index, b = { lower: index * units / scale, upper: (index + 1) * units / scale, count: 0, accCount: 0, accSum: 0, avgAcc: null, bestPp: null });
    b.count++;
    if (finite(p.acc) && p.acc >= 0 && p.acc <= 100) { b.accCount++; b.accSum += p.acc; }
    if (finite(p.pp) && p.pp >= 0 && (b.bestPp === null || p.pp > b.bestPp)) b.bestPp = p.pp;
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => {
    b.avgAcc = b.accCount ? b.accSum / b.accCount : null; delete b.accSum; return b;
  });
}
export function sampleExtrema(rows, value, limit = 6000) {
  if (rows.length <= limit) return rows;
  const groups = new Map(), first = rows[0].played_at, span = Math.max(1, rows.at(-1).played_at - first);
  const metrics = Array.isArray(value) ? value : [value];
  const count = Math.floor((limit - 2) / (2 * metrics.length));
  for (let i = 0; i < rows.length; i++) {
    const k = Math.min(count - 1, Math.floor((rows[i].played_at - first) / span * count));
    let g = groups.get(k);
    if (!g) groups.set(k, g = metrics.map(() => ({ min: i, max: i })));
    metrics.forEach((metric, j) => {
      if (rows[i][metric] < rows[g[j].min][metric]) g[j].min = i;
      if (rows[i][metric] > rows[g[j].max][metric]) g[j].max = i;
    });
  }
  const indices = new Set([0, rows.length - 1]);
  for (const group of groups.values()) for (const g of group) { indices.add(g.min); indices.add(g.max); }
  return [...indices].sort((a, b) => a - b).map(i => rows[i]);
}
export function summarize(rows, rangeDays, { arStep = 0.5, bpmStep = 10, now = Date.now() } = {}) {
  const from = rangeDays ? now - rangeDays * 86400000 : 0, to = now + 1;
  rows = rows.filter(p => p.played_at >= from && p.played_at < to).sort((a, b) => a.played_at - b.played_at || a.id - b.id);
  const agg = { totalPlays: rows.length, totalDays: 0, maxPp: null, maxAcc: null, avgAcc: null, playDays7: 0, plays7: 0, setCount: 0 };
  const days = new Map(), sets = new Set(), recentDays = new Set(), arHist = {}, bpmHist = {}, modCounts = {};
  let accSum = 0, accN = 0;
  const allPp = [], allTempo = [];
  for (const p of rows) {
    const day = localDay(p.played_at);
    let d = days.get(day);
    if (!d) days.set(day, d = { d: day, t: dayAtNoon(day), n: 0, toppp: null, avgacc: null, topacc: null, minacc: null, accSum: 0, accN: 0 });
    d.n++;
    if (p.set_id != null) sets.add(p.set_id);
    if (p.played_at >= now - 7 * 86400000) { agg.plays7++; recentDays.add(day); }
    if (finite(p.pp) && p.pp >= 0) {
      agg.maxPp = Math.max(agg.maxPp ?? 0, p.pp); d.toppp = Math.max(d.toppp ?? 0, p.pp); allPp.push(p);
    }
    if (finite(p.acc) && p.acc >= 0 && p.acc <= 100) {
      accSum += p.acc; accN++; d.accSum += p.acc; d.accN++;
      agg.maxAcc = Math.max(agg.maxAcc ?? 0, p.acc); d.topacc = Math.max(d.topacc ?? 0, p.acc); d.minacc = Math.min(d.minacc ?? 100, p.acc);
      if (finite(p.bpm) && p.bpm > 0) allTempo.push(p);
    }
    if (finite(p.ar) && p.ar >= 0) { const k = Math.round(p.ar * 10) / 10; arHist[k] = (arHist[k] || 0) + 1; }
    if (finite(p.bpm) && p.bpm > 0) { const k = Math.round(p.bpm / 10) * 10; bpmHist[k] = (bpmHist[k] || 0) + 1; }
    for (let mod of String(p.mods || 'NM').split(',').map(s => s.trim()).filter(Boolean)) {
      if (!/^[A-Z][A-Z0-9]{0,3}$/.test(mod)) mod = 'UNKNOWN';
      modCounts[mod] = (modCounts[mod] || 0) + 1;
    }
  }
  agg.totalDays = days.size; agg.setCount = sets.size; agg.playDays7 = recentDays.size; agg.avgAcc = accN ? accSum / accN : null;
  const series = [...days.values()].map(d => { d.avgacc = d.accN ? d.accSum / d.accN : null; delete d.accSum; delete d.accN; return d; });
  const start = new Date(rangeDays ? from : (rows[0]?.played_at ?? now)); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
  const selectPoint = p => Object.fromEntries(['id', 'played_at', 'pp', 'acc', 'bpm', 'ar', 'stars', 'set_id', 'md5', 'artist', 'title', 'version', 'mods', 'grade'].map(k => [k, p[k] ?? null]));
  const ppSeries = sampleExtrema(allPp, 'pp').map(selectPoint), stream = sampleExtrema(allTempo, ['acc', 'bpm']).map(selectPoint);
  return { agg, series, arHist, bpmHist, modCounts, ppSeries, stream,
    arBuckets: bucketize(rows, 'ar', arStep), bpmBuckets: bucketize(rows, 'bpm', bpmStep),
    range: { from, to, plotFrom: start.getTime(), plotTo: end.getTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    points: { pp: { total: allPp.length, shown: ppSeries.length }, tempo: { total: allTempo.length, shown: stream.length } } };
}
