/* osu-diary 前端：日历 / 统计 / 成绩列表 / 设置 */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: opts.body ? { 'content-type': 'text/plain' } : {}, ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------------- 工具 ---------------- */
const fmt = {
  n: (v, d = 2) => v === null || v === undefined ? '—' : Number(v).toFixed(d),
  acc: (v) => v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`,
  pp: (v) => v === null || v === undefined ? '—' : `${Math.round(v)}pp`,
  time: (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; },
  day: (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  dt: (ms) => { const d = new Date(ms); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; },
};

function displayName(p) {
  const artist = p.artist_uni || p.artist || '';
  const title = p.title_uni || p.title || '';
  return { artist, title, full: `${artist} - ${title}${p.version ? ` [${p.version}]` : ''}` };
}

function coverUrl(setId) { return setId ? `/api/cover/${setId}` : null; }

function coverHtml(p, cls = 'thumb') {
  const url = coverUrl(p.set_id);
  const { title } = displayName(p);
  const hue = (p.set_id || 0) % 360;
  const inner = url
    ? `<img class="${cls}" src="${url}" loading="lazy" onerror="this.outerHTML='<div class=&quot;${cls}&quot; style=&quot;background:linear-gradient(135deg,hsl(${hue},40%,22%),hsl(${(hue + 40) % 360},40%,14%)&quot;></div>'">`
    : `<div class="${cls}" style="background:linear-gradient(135deg,hsl(${hue},40%,22%),hsl(${(hue + 40) % 360},40%,14%))"></div>`;
  return `<span class="mt">${inner}</span>`;
}

function gradeCls(g) {
  const v = String(g || '').toUpperCase();
  if (/^(SS|SSH|X|XH)$/.test(v)) return 'g-SS';
  return `g-${v}`;
}

/** mods 的默认倍速（DT/NC=1.5，HT=0.75，其余 1） */
function defaultRate(mods) {
  const list = String(mods || '').split(',').map(s => s.trim());
  if (list.includes('DT') || list.includes('NC')) return 1.5;
  if (list.includes('HT')) return 0.75;
  return 1;
}

function modsPills(mods, rate) {
  const list = String(mods || 'NM').split(',').map(s => s.trim()).filter(Boolean);
  let pills = (list.length ? list : ['NM']).map(m => `<span class="pill">${esc(m)}</span>`).join('');
  // 自定义倍速（lazer 的 DT 变速等）与默认不同才显示
  if (rate != null && rate !== defaultRate(mods)) {
    pills += `<span class="pill" style="background:#3a2a3a;color:#ff8fc4;font-weight:600">×${Number(rate).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}</span>`;
  }
  return pills;
}

function mapLink(p) {
  return p.md5 ? `#map?md5=${p.md5}` : null;
}

/** osu direct 游戏内打开 */
function osuDirectUrl(p) {
  if (p.map_id) return `osu://b/${p.map_id}`;
  if (p.set_id) return `osu://s/${p.set_id}`;
  return null;
}

function webUrl(p) {
  if (p.map_id) return `https://osu.ppy.sh/b/${p.map_id}`;
  if (p.set_id) return `https://osu.ppy.sh/beatmapsets/${p.set_id}`;
  return null;
}

function fmtLength(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------- 路由 ---------------- */
const VIEWS = ['cal', 'stats', 'plays', 'map', 'settings'];

function route() {
  const hash = location.hash.replace('#', '');
  const [v, qs] = hash.split('?');
  const name = VIEWS.includes(v) ? v : 'cal';
  for (const n of VIEWS) {
    const el = $(`#view-${n}`);
    if (el) el.hidden = n !== name;
  }
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  if (name === 'cal') renderCalendar();
  if (name === 'stats') renderStats();
  if (name === 'plays') renderPlays();
  if (name === 'map') renderMap(new URLSearchParams(qs || '').get('md5'));
  if (name === 'settings') { refreshStatus(); loadSettings(); }
}
window.addEventListener('hashchange', route);

/** 谱面页返回：回到上一个视图 */
let lastNonMapHash = '#cal';
function gotoMap(md5) {
  if (!location.hash.startsWith('#map')) lastNonMapHash = location.hash || '#cal';
  location.hash = `#map?md5=${md5}`;
}

/* ---------------- 日历 ---------------- */
let calMonth = new Date();
function monthStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

async function renderCalendar() {
  const m = monthStr(calMonth);
  $('#calTitle').textContent = `${calMonth.getFullYear()}年${calMonth.getMonth() + 1}月`;
  let data;
  try { data = await api(`/api/calendar?month=${m}`); } catch (e) { $('#calGrid').innerHTML = `<div class="empty-hint">加载失败：${esc(e.message)}</div>`; return; }

  const byDay = new Map(data.map(d => [d.day, d]));
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // 周一开头

  let html = '';
  for (const w of ['一', '二', '三', '四', '五', '六', '日']) html += `<div class="cal-dow">${w}</div>`;
  for (let i = 0; i < lead; i++) html += `<div class="cal-cell empty"></div>`;
  const today = fmt.day(Date.now());

  for (let d = 1; d <= daysInMonth; d++) {
    const day = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = byDay.get(day);
    const cls = ['cal-cell'];
    if (day === today) cls.push('today');
    if (!info) cls.push('empty');
    if (!info) { html += `<div class="cal-cell empty"><div class="cal-num">${d}</div></div>`; continue; }
    const top = info.top || {};
    const nm = displayName(top);
    const url = coverUrl(top.set_id);
    const bg = url ? `background-image:url('${url}')` : `background-image:linear-gradient(135deg,hsl(${(top.set_id || 0) % 360},35%,24%),hsl(${((top.set_id || 0) + 60) % 360},35%,13%))`;
    html += `<div class="${cls.join(' ')}" data-day="${day}">
      <div class="cal-bg" style="${bg}"></div><div class="cal-shade"></div>
      <div class="cal-num">${d}</div>
      <div class="cal-count">${info.count} 局</div>
      <div class="cal-bottom">
        <div><span class="cal-pp">${top.pp != null ? Math.round(top.pp) + 'pp' : fmt.acc(top.acc)}</span>
        <span class="cal-acc">${top.acc != null ? top.acc.toFixed(1) + '%' : ''}</span></div>
        <div class="cal-title">${esc(nm.title || nm.full)}${top.version ? ` <span style="opacity:.7">[${esc(top.version)}]</span>` : ''}</div>
      </div>
    </div>`;
  }
  $('#calGrid').innerHTML = html;
  $('#calSummary').textContent = `本月 ${data.reduce((s, x) => s + x.count, 0)} 局 · ${data.length} 天有记录`;

  $('#calGrid').querySelectorAll('.cal-cell[data-day]').forEach(cell => {
    cell.addEventListener('click', () => openDrawer(cell.dataset.day));
  });
}

/* ---------------- 抽屉 ---------------- */
async function openDrawer(day) {
  $('#drawerTitle').textContent = day;
  $('#drawerBody').innerHTML = '<div class="empty-hint">加载中…</div>';
  $('#drawer').hidden = false;
  $('#drawerMask').hidden = false;
  let rows;
  try { rows = await api(`/api/day?date=${day}`); } catch (e) { $('#drawerBody').innerHTML = `<div class="empty-hint">${esc(e.message)}</div>`; return; }

  const sumPp = rows.reduce((s, r) => s + (r.pp || 0), 0);
  const best = rows.slice().sort((a, b) => (b.pp || 0) - (a.pp || 0))[0];
  $('#drawerBody').innerHTML = `
    <div class="day-stat">${rows.length} 局 · 最高 ${fmt.pp(best?.pp)}${best?.acc != null ? ` · ${best.acc.toFixed(2)}%` : ''} · 合计 pp ${Math.round(sumPp)}</div>
    ${rows.map(r => {
      const nm = displayName(r);
      const mlink = mapLink(r);
      const osu = osuDirectUrl(r);
      const web = webUrl(r);
      return `<div class="play-row">
        ${coverHtml(r, 'thumb')}
        <div class="info">
          <div class="t">${mlink ? `<a href="${mlink}" style="color:inherit;text-decoration:none">${esc(nm.full)}</a>` : esc(nm.full)}</div>
          <div class="d">${fmt.time(r.played_at)} · ${modsPills(r.mods, r.mods_rate)} · AR ${fmt.n(r.ar, 1)} · ${fmt.n(r.bpm, 1)}bpm · ${fmt.n(r.stars, 2)}★ ${osu ? `<a class="ext" href="${osu}">游戏内</a>` : ''} ${web ? `<a class="ext" href="${web}" target="_blank">网页</a>` : ''}</div>
        </div>
        <div class="nums">
          <div class="pp">${fmt.pp(r.pp)}</div>
          <div>${fmt.acc(r.acc)} <span class="${gradeCls(r.grade)}">${esc(r.grade || '')}</span> ${r.nmiss ? `<span style="color:var(--bad)">${r.nmiss}×</span>` : ''}</div>
        </div>
        <button class="del" data-id="${r.id}" title="删除这条记录">✕</button>
      </div>`;
    }).join('')}
  `;
  $('#drawerBody').querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('删除这条记录？')) return;
      await api(`/api/plays/${btn.dataset.id}`, { method: 'DELETE' });
      openDrawer(day);
      renderCalendar();
    });
  });
}
function closeDrawer() { $('#drawer').hidden = true; $('#drawerMask').hidden = true; }

/* ---------------- SVG 图表 ---------------- */
function svgEl(w, h) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
}
function axes(svg, W, H, pad, opts) {
  const { yMin, yMax, yTicks = 5, xTicks = 6, xFmt, yFmt = v => v } = opts;
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const y = v => pad.t + innerH * (1 - (v - yMin) / (yMax - yMin));
  const x = i => pad.l + innerW * i;
  const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  grid.setAttribute('class', 'grid');
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + (yMax - yMin) * i / yTicks;
    const yy = y(v);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', pad.l); line.setAttribute('x2', W - pad.r);
    line.setAttribute('y1', yy); line.setAttribute('y2', yy);
    grid.appendChild(line);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('class', 'tick'); t.setAttribute('x', pad.l - 6); t.setAttribute('y', yy + 3);
    t.setAttribute('text-anchor', 'end'); t.textContent = yFmt(v);
    grid.appendChild(t);
  }
  svg.appendChild(grid);
  if (xFmt) {
    for (let i = 0; i <= xTicks; i++) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('class', 'tick'); t.setAttribute('x', x(i / xTicks)); t.setAttribute('y', H - 4);
      t.setAttribute('text-anchor', 'middle'); t.textContent = xFmt(i / xTicks);
      svg.appendChild(t);
    }
  }
  return { y, x, innerW, innerH };
}
function linePath(pts, y, x) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0])},${y(p[1])}`).join(' ');
}
function addLine(svg, pts, y, x, { color, width = 1.6, dash } = {}) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', linePath(pts, y, x));
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', width);
  if (dash) path.setAttribute('stroke-dasharray', dash);
  svg.appendChild(path);
}

function timeScale(data, W, pad) {
  const tMin = Math.min(...data.map(d => d.t));
  const tMax = Math.max(...data.map(d => d.t), tMin + 1);
  return v => pad.l + (W - pad.l - pad.r) * (v - tMin) / (tMax - tMin);
}

/** 分布直方图：细粒度分箱；悬停显示详情气泡，点击展开该分箱的成绩明细 */
function histChart(sel, hist, { xMin = 0, xMax = 11, xFmt = v => v, unit = '', bin = 1 } = {}) {
  const el = $(sel);
  const bins = Object.keys(hist || {}).map(Number).sort((a, b) => a - b);
  if (!bins.length) { el.innerHTML = '<div class="empty-hint">暂无数据</div>'; return; }
  const W = 620, H = 230, pad = { l: 40, r: 12, t: 12, b: 26 };
  const svg = svgEl(W, H);
  const maxN = Math.max(1, ...bins.map(b => hist[b]));
  const hi = Math.max(xMax, Math.ceil(bins[bins.length - 1] + bin)); // 轴延伸到数据上限或下限之外
  const { y, x } = axes(svg, W, H, pad, { yMin: 0, yMax: maxN, yTicks: 4, yFmt: v => Math.round(v), xFmt: f => xFmt(xMin + (hi - xMin) * f) });
  const bw = (W - pad.l - pad.r) / Math.max(1, Math.round((hi - xMin) / bin)) * .78;
  const detailEl = document.getElementById(`${sel.slice(1)}Detail`);
  let curSel = null;

  for (const b of bins) {
    if (b > hi || b < xMin) continue;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const bx = x((b - xMin) / Math.max(0.001, hi - xMin)) - bw / 2;
    rect.setAttribute('x', bx); rect.setAttribute('width', Math.max(2.5, bw));
    rect.setAttribute('y', y(hist[b])); rect.setAttribute('height', Math.max(2, pad.t + (H - pad.t - pad.b) - y(hist[b])));
    rect.setAttribute('fill', unit === 'AR' ? '#8b5cf6' : '#5ac8fa'); rect.setAttribute('rx', 1.5);
    rect.setAttribute('opacity', Math.min(1, .45 + hist[b] / maxN * .55));
    const total = bins.reduce((s, k) => s + hist[k], 0);
    const pct = (hist[b] / total * 100).toFixed(1);
    const tip = `${unit} ${b}：${hist[b]} 局（占 ${pct}%）`;
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = tip;
    rect.appendChild(title);
    // 悬停气泡
    rect.addEventListener('mousemove', (e) => showTip(tip, e));
    rect.addEventListener('mouseleave', hideTip);
    // 点击展开明细
    rect.addEventListener('click', async () => {
      if (!detailEl) return;
      if (curSel === b) { detailEl.innerHTML = ''; curSel = null; return; }
      curSel = b;
      const half = bin / 2;
      const p = new URLSearchParams({ limit: 50, sort: 'pp', dir: 'desc' });
      p.set(unit === 'AR' ? 'arMin' : 'bpmMin', b - half);
      p.set(unit === 'AR' ? 'arMax' : 'bpmMax', b + half);
      detailEl.innerHTML = `<div class="hint">${tip} — 加载中…</div>`;
      try {
        const data = await api(`/api/plays?${p}`);
        detailEl.innerHTML = `<div class="hint">${tip}（共 ${data.total} 局，显示前 50）</div>` +
          `<div class="tblwrap" style="max-height:260px"><table>
            <thead><tr><th>时间</th><th>图</th><th>mods</th><th class="n">acc</th><th class="n">pp</th><th class="n">miss</th></tr></thead>
            <tbody>${data.rows.map(r => {
              const nm = displayName(r);
              const mlink = mapLink(r);
              return `<tr>
                <td class="n" style="color:var(--mut)">${fmt.dt(r.played_at)}</td>
                <td>${mlink ? `<a href="${mlink}" style="color:inherit;text-decoration:none">${esc(nm.full)}</a>` : esc(nm.full)}</td>
                <td>${modsPills(r.mods, r.mods_rate)}</td>
                <td class="n">${fmt.acc(r.acc)}</td>
                <td class="n" style="font-weight:700">${fmt.pp(r.pp)}</td>
                <td class="n">${r.nmiss ?? 0}</td>
              </tr>`;
            }).join('')}</tbody></table></div>`;
      } catch (e) { detailEl.innerHTML = `<div class="hint">加载失败：${esc(e.message)}</div>`; }
    });
    svg.appendChild(rect);
  }
  el.innerHTML = ''; el.appendChild(svg);
}

/* ---------------- 悬浮气泡 ---------------- */
let tipEl = null;
function ensureTip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'chartTip';
    tipEl.style.cssText = 'position:fixed;z-index:99;pointer-events:none;background:#262a36;border:1px solid #3a3f52;' +
      'border-radius:8px;padding:6px 10px;font-size:12px;color:#e9eaf2;box-shadow:0 4px 14px rgba(0,0,0,.5);display:none;white-space:nowrap';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
function showTip(text, e) {
  const t = ensureTip();
  t.textContent = text;
  t.style.display = 'block';
  const pad = 14;
  t.style.left = Math.min(window.innerWidth - t.offsetWidth - pad, e.clientX + pad) + 'px';
  t.style.top = Math.min(window.innerHeight - t.offsetHeight - pad, e.clientY + pad) + 'px';
}
function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

/* ---------------- 统计 ---------------- */
async function renderStats() {
  const range = $('#statsRange').value;
  let s;
  try { s = await api(`/api/stats?range=${range}`); } catch (e) { return; }
  const { agg, series, arHist, bpmHist, modCounts, stream, ppSeries } = s;

  const kpi = (k, v, d) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d || ''}</div></div>`;
  $('#kpis').innerHTML =
    kpi('总成绩', agg.totalPlays, '范围内') +
    kpi('游玩天数', agg.totalDays, '近 7 天有 ' + agg.playDays7 + ' 天在打') +
    kpi('最近 7 天', agg.plays7, '局') +
    kpi('最高 PP', fmt.pp(agg.maxPp), '') +
    kpi('平均 ACC', fmt.acc(agg.avgAcc), '') +
    kpi('总图数', agg.setCount ?? 0, '');

  // PP 走势
  {
    const W = 620, H = 240, pad = { l: 44, r: 12, t: 12, b: 22 };
    const svg = svgEl(W, H);
    const ppMax = Math.max(10, ...ppSeries.map(p => p.pp || 0));
    const sc = { yMin: 0, yMax: ppMax * 1.08, yFmt: v => Math.round(v) };
    const { y, x } = axes(svg, W, H, pad, { ...sc, xFmt: f => fmt.dt(ppSeries[Math.min(ppSeries.length - 1, Math.round(f * (ppSeries.length - 1)))]?.played_at || Date.now()).slice(5) });
    ppSeries.forEach(p => {
      if (p.pp == null) return;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x((p.played_at - ppSeries[0].played_at) / Math.max(1, ppSeries[ppSeries.length - 1].played_at - ppSeries[0].played_at)));
      c.setAttribute('cy', y(p.pp)); c.setAttribute('r', 2.2); c.setAttribute('fill', '#ff66aa'); c.setAttribute('opacity', .55);
      svg.appendChild(c);
    });
    const days = series.filter(d => d.toppp != null);
    if (days.length > 1) {
      const xs = v => pad.l + (W - pad.l - pad.r) * (new Date(v.d).getTime() - new Date(days[0].d).getTime()) / Math.max(1, new Date(days[days.length - 1].d).getTime() - new Date(days[0].d).getTime());
      addLine(svg, days.map(d => [new Date(d.d).getTime(), d.toppp]), y, xs, { color: '#ffd76e' });
    }
    $('#chartPp').innerHTML = ''; $('#chartPp').appendChild(svg);
  }
  // ACC 走势
  {
    const W = 620, H = 240, pad = { l: 44, r: 12, t: 12, b: 22 };
    const svg = svgEl(W, H);
    const { y } = axes(svg, W, H, pad, { yMin: 80, yMax: 100, yTicks: 4, yFmt: v => v + '%' });
    const days = series.filter(d => d.avgacc != null);
    if (days.length > 1) {
      const t0 = new Date(days[0].d).getTime(), t1 = new Date(days[days.length - 1].d).getTime();
      const xs = v => pad.l + (W - pad.l - pad.r) * (v - t0) / Math.max(1, t1 - t0);
      addLine(svg, days.map(d => [new Date(d.d).getTime(), d.avgacc]), y, xs, { color: '#5ac8fa' });
      addLine(svg, days.filter(d => d.topacc != null).map(d => [new Date(d.d).getTime(), d.topacc]), y, xs, { color: '#ff66aa', dash: '3 3' });
    } else if (days.length === 1) {
      $('#chartAcc').innerHTML = '<div class="empty-hint">数据还太少，多打几天再来</div>';
    }
    $('#chartAcc').innerHTML = ''; $('#chartAcc').appendChild(svg);
  }
  // 串速
  {
    const W = 620, H = 260, pad = { l: 44, r: 12, t: 12, b: 26 };
    const svg = svgEl(W, H);
    const bpmMax = Math.max(200, ...stream.map(p => p.bpm || 0));
    const bpmMin = Math.min(...stream.map(p => p.bpm || 99999));
    const { y, x } = axes(svg, W, H, pad, { yMin: 0, yMax: 100, yTicks: 4, yFmt: v => v + '%', xFmt: f => Math.round(bpmMin + (bpmMax - bpmMin) * f) });
    addLine(svg, [[0, 95], [1, 95]], y, v => pad.l + (W - pad.l - pad.r) * v, { color: '#f2c14e', dash: '5 4' });
    const starsMax = Math.max(1, ...stream.map(p => p.stars || 0));
    stream.forEach(p => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x((p.bpm - bpmMin) / Math.max(1, bpmMax - bpmMin)));
      c.setAttribute('cy', y(p.acc)); c.setAttribute('r', 2.4);
      const hue = 200 - 180 * Math.min(1, p.stars / starsMax);
      c.setAttribute('fill', `hsl(${hue},85%,62%)`); c.setAttribute('opacity', .6);
      svg.appendChild(c);
    });
    $('#chartStream').innerHTML = ''; $('#chartStream').appendChild(svg);
  }
  // AR / BPM 分布（细粒度分箱 + 悬停显示精确值）
  histChart('#chartAr', arHist, { xMax: 11, xMin: 0, xFmt: v => v.toFixed(1), unit: 'AR', bin: 0.1 });
  histChart('#chartBpm', bpmHist, { xMax: 400, xMin: 0, xFmt: v => Math.round(v), unit: 'BPM', bin: 10 });
  // Mods
  {
    const entries = Object.entries(modCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxN = Math.max(1, ...entries.map(e => e[1]));
    $('#chartMods').innerHTML = entries.map(([m, n]) => `
      <div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px">
        <span style="width:46px;color:var(--mut);flex:none">${esc(m)}</span>
        <div style="flex:1;height:12px;background:var(--panel2);border-radius:6px;overflow:hidden">
          <div style="width:${n / maxN * 100}%;height:100%;background:linear-gradient(90deg,#ff66aa,#5ac8fa);border-radius:6px"></div>
        </div>
        <span style="width:36px;text-align:right;font-variant-numeric:tabular-nums">${n}</span>
      </div>`).join('') || '<div class="empty-hint">暂无数据</div>';
  }
}

/* ---------------- 成绩列表 ---------------- */
let playsState = { q: '', mods: '', minPp: '', sort: 'played_at', dir: 'desc', offset: 0, limit: 50 };

async function renderPlays() {
  const p = new URLSearchParams({ sort: playsState.sort, dir: playsState.dir, limit: playsState.limit, offset: playsState.offset });
  if (playsState.q) p.set('q', playsState.q);
  if (playsState.mods) p.set('mods', playsState.mods);
  if (playsState.minPp) p.set('minPp', playsState.minPp);
  let data;
  try { data = await api(`/api/plays?${p}`); } catch (e) { return; }
  $('#playsTotal').textContent = `共 ${data.total} 条`;
  const tbody = $('#playsTable tbody');
  tbody.innerHTML = data.rows.map(r => {
    const nm = displayName(r);
    const mlink = mapLink(r);
    return `<tr>
      <td class="n" style="color:var(--mut)">${fmt.dt(r.played_at)}</td>
      <td><div class="mt">${coverHtml(r, 'thumb')}<div class="info">
        <div class="t">${mlink ? `<a href="${mlink}" style="color:inherit;text-decoration:none">${esc(nm.full)}</a>` : esc(nm.full)}</div>
        <div class="d">${esc(r.creator || '')}</div></div></div></td>
      <td>${modsPills(r.mods, r.mods_rate)}</td>
      <td class="n">${fmt.n(r.ar, 1)}</td>
      <td class="n">${fmt.n(r.bpm, 1)}</td>
      <td class="n">${fmt.n(r.stars, 2)}</td>
      <td class="n">${fmt.acc(r.acc)}</td>
      <td class="n" style="font-weight:700">${fmt.pp(r.pp)}</td>
      <td><span class="grade ${gradeCls(r.grade)}">${esc(r.grade || '')}</span></td>
      <td class="n">${r.nmiss ?? 0}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="10" class="empty-hint">没有符合条件的记录</td></tr>`;

  // 排序指示
  document.querySelectorAll('#playsTable th.sortable').forEach(th => {
    const el = th.querySelector('.sdir');
    if (el) el.textContent = th.dataset.sort === playsState.sort ? (playsState.dir === 'asc' ? '▲' : '▼') : '';
  });

  const pages = Math.ceil(data.total / playsState.limit);
  const cur = Math.floor(playsState.offset / playsState.limit) + 1;
  $('#playsPager').innerHTML = `
    <button class="ghost" id="pgPrev" ${playsState.offset === 0 ? 'disabled' : ''}>‹ 上一页</button>
    <button class="ghost" id="pgNext" ${playsState.offset + playsState.limit >= data.total ? 'disabled' : ''}>下一页 ›</button>
    <span class="info">第 ${cur}/${Math.max(1, pages)} 页</span>`;
  $('#pgPrev')?.addEventListener('click', () => { playsState.offset = Math.max(0, playsState.offset - playsState.limit); renderPlays(); });
  $('#pgNext')?.addEventListener('click', () => { playsState.offset += playsState.limit; renderPlays(); });
}

/* ---------------- 设置 / 状态 ---------------- */
async function refreshStatus() {
  try {
    const s = await api('/api/status');
    setDot('#dotTosu', s.tosu.connected);
    $('#lblTosu').textContent = s.tosu.connected ? 'tosu ✓' : 'tosu ✗';
    $('#lblGame').textContent = s.tosu.state || '—';
    setDot('#dotGame', !!s.tosu.state && s.tosu.state !== '?');
    $('#statusLine').innerHTML = `数据库：<b>${s.db.count}</b> 条成绩` +
      (s.db.lastPlay ? ` · 最近一局 ${fmt.dt(s.db.lastPlay.playedAt)} ${esc(s.db.lastPlay.artist)} - ${esc(s.db.lastPlay.title)} ${fmt.pp(s.db.lastPlay.pp)}` : '');
  } catch (e) {
    $('#statusLine').textContent = '服务未响应：' + e.message;
  }
}
function setDot(sel, on) {
  const el = $(sel);
  el.classList.toggle('on', !!on);
  el.classList.toggle('off', !on);
}

async function doImportRealm() {
  const btn = $('#btnImportRealm');
  const msg = $('#realmMsg');
  btn.disabled = true; msg.className = 'import-msg'; msg.textContent = '导入中（复制 realm + 解析，可能需要十几秒）…';
  try {
    const r = await api('/api/import/realm', { method: 'POST', body: JSON.stringify({}) });
    msg.className = 'import-msg ok';
    const f = r.foreign || {};
    msg.textContent = `导入完成：新增 ${r.ok} 条，跳过 ${r.skip} 条。` +
      (f.purged > 0 ? `\n已清理非本人成绩 ${f.purged} 条（${(f.users || []).join(', ') || '其他玩家'}）。` : '') +
      (r.selfUser?.name ? `\n识别本人账号：${r.selfUser.name}（id ${r.selfUser.id ?? '—'}）。` : '');
    if (r.ppStarted) await pollJob('/api/import/pp/progress', msg, '正在用 rosu-pp 计算历史 pp…');
    if (r.pullStarted) await pollJob('/api/pp/pull/progress', msg, '正在从 osu! API 拉取官方 pp…');
    refreshStatus(); renderCalendar(); loadSettings();
  } catch (e) {
    msg.className = 'import-msg err';
    msg.textContent = '导入失败：' + e.message + '\n提示：osu!lazer 运行中可能锁住 realm，可以先关掉 lazer 再试。';
  } finally { btn.disabled = false; }
}

async function doCalcPp() {
  const msg = $('#realmMsg');
  msg.className = 'import-msg';
  try {
    const r = await api('/api/import/pp', { method: 'POST' });
    if (r.started) await pollJob('/api/import/pp/progress', msg, '正在用 rosu-pp 计算历史 pp…');
  } catch (e) { msg.className = 'import-msg err'; msg.textContent = e.message; }
}

async function doWarmupCovers() {
  const msg = $('#coversMsg');
  msg.className = 'import-msg';
  try {
    const r = await api('/api/covers/warmup', { method: 'POST' });
    if (r.started) await pollJob('/api/covers/warmup/progress', msg, '正在预取封面…');
  } catch (e) { msg.className = 'import-msg err'; msg.textContent = e.message; }
}

/** 轮询后台任务直到完成 */
async function pollJob(url, msgEl, label) {
  for (;;) {
    await new Promise(r => setTimeout(r, 1500));
    let s;
    try { s = await api(url); } catch { continue; }
    const extra = s.total ? `（${s.i}/${s.total}）` : '';
    msgEl.textContent = `${label}${extra} ${s.msg || ''}`;
    if (!s.running) { msgEl.className = 'import-msg ok'; break; }
  }
}

/* ---------------- 谱面页 ---------------- */
async function renderMap(md5) {
  const body = $('#mapBody');
  if (!md5) { body.innerHTML = '<div class="empty-hint">缺少谱面参数</div>'; return; }
  let info;
  try { info = await api(`/api/map?md5=${encodeURIComponent(md5)}`); }
  catch (e) { body.innerHTML = `<div class="empty-hint">加载失败：${esc(e.message)}</div>`; return; }

  const m = info.map;
  const nm = displayName(m);
  const osu = osuDirectUrl(m);
  const web = webUrl(m);
  $('#mapLinks').innerHTML =
    (osu ? `<a class="ext" href="${osu}">🎮 游戏内打开</a>` : '') +
    (web ? ` <a class="ext" href="${web}" target="_blank">🌐 网页</a>` : '');

  const stat = (k, v) => `<div class="mstat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  body.innerHTML = `
    <div class="panel map-head">
      <div class="map-cover">${coverHtml(m, 'thumb big')}</div>
      <div class="map-info">
        <div class="map-title">${esc(nm.full)}</div>
        <div class="mut small">mapper：${esc(m.creator || '—')}${m.source ? ` · source：${esc(m.source)}` : ''} · 长度 ${fmtLength(m.length_ms)}</div>
        <div class="mstats">
          ${stat('AR', fmt.n(m.ar, 1))}${stat('OD', fmt.n(m.od, 1))}${stat('CS', fmt.n(m.cs, 1))}${stat('HP', fmt.n(m.hp, 1))}
          ${stat('BPM', fmt.n(m.bpm, 1))}${stat('★', fmt.n(m.stars, 2))}
        </div>
      </div>
    </div>
    <div class="panel">
      <h2>历史成绩（${info.agg.n} 局）</h2>
      <div class="hint">最高 ${fmt.pp(info.agg.toppp)} · 最高 acc ${fmt.acc(info.agg.topacc)} · 平均 acc ${fmt.acc(info.agg.avgacc)} · 首次 ${fmt.dt(info.agg.first)} · 最近 ${fmt.dt(info.agg.last)}</div>
      <div class="tblwrap" style="max-height:420px"><table>
        <thead><tr><th>时间</th><th>mods</th><th class="n">AR</th><th class="n">acc</th><th class="n">pp</th><th>grade</th><th class="n">miss</th><th class="n">combo</th></tr></thead>
        <tbody>${info.plays.map(r => `<tr>
          <td class="n" style="color:var(--mut)">${fmt.dt(r.played_at)}</td>
          <td>${modsPills(r.mods, r.mods_rate)}</td>
          <td class="n">${fmt.n(r.ar, 1)}</td>
          <td class="n">${fmt.acc(r.acc)}</td>
          <td class="n" style="font-weight:700">${fmt.pp(r.pp)}</td>
          <td><span class="grade ${gradeCls(r.grade)}">${esc(r.grade || '')}</span></td>
          <td class="n">${r.nmiss ?? 0}</td>
          <td class="n">${r.max_combo ?? 0}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    ${info.diffs.length > 1 ? `
    <div class="panel">
      <h2>同图集其他难度</h2>
      <div class="hint">点击切换</div>
      <div class="diff-grid">
        ${info.diffs.map(d => {
          const cur = d.md5 === md5;
          return `<div class="diff-cell ${cur ? 'cur' : ''}" data-md5="${esc(d.md5)}">
            <div class="t">[${esc(d.version)}]</div>
            <div class="d">★${fmt.n(d.stars, 2)} · AR ${fmt.n(d.ar, 1)} · ${fmt.n(d.bpm, 1)}bpm</div>
            <div class="d">最高 ${fmt.pp(d.pp)} · ${fmt.acc(d.acc)} · ${d.n} 局</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
  `;
  body.querySelectorAll('.diff-cell').forEach(c => {
    c.addEventListener('click', () => renderMap(c.dataset.md5));
  });
}

/* ---------------- 设置 ---------------- */
async function loadSettings() {
  try {
    const c = await api('/api/config');
    $('#cfgUsers').value = c.users || '';
    $('#cfgClientId').value = c.clientId || '';
    $('#cfgClientSecret').value = c.clientSecret || '';
    $('#cfgOsuUserId').value = c.osuUserId || '';
    const info = [];
    if (c.selfName) info.push(`已识别账号：${c.selfName}`);
    if (c.osuUserName) info.push(`id ${c.osuUserName === c.selfName ? '' : c.osuUserName + ' '}${c.osuUserId || ''}`);
    $('#selfInfo').textContent = c.selfName ? `（已识别：${c.selfName}，id ${c.osuUserId || '—'}）` : '';
  } catch {}
}

async function doSaveUsers() {
  const msg = $('#usersMsg');
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify({ users: $('#cfgUsers').value.trim() }) });
    msg.className = 'import-msg ok';
    msg.textContent = '已保存' + ($('#cfgUsers').value.trim() ? '' : '（留空 = 自动只记录你的游戏账号）');
  } catch (e) { msg.className = 'import-msg err'; msg.textContent = e.message; }
}

async function doPurgeForeign() {
  const msg = $('#usersMsg');
  if (!confirm('删除所有"非本人"的成绩？此操作不可撤销。')) return;
  msg.className = 'import-msg';
  try {
    const r = await api('/api/plays/purge-foreign', { method: 'POST' });
    msg.className = 'import-msg ok';
    msg.textContent = r.deleted ? `已清理 ${r.deleted} 条非本人成绩（保留名单：${r.kept.join(', ')}）。` : (r.note || '没有需要清理的记录');
    refreshStatus(); renderCalendar();
  } catch (e) { msg.className = 'import-msg err'; msg.textContent = e.message; }
}

async function doSaveApi() {
  const msg = $('#pullMsg');
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify({
      clientId: $('#cfgClientId').value.trim(),
      clientSecret: $('#cfgClientSecret').value.trim(),
      osuUserId: $('#cfgOsuUserId').value.trim(),
    }) });
    msg.className = 'import-msg ok'; msg.textContent = '凭证已保存';
  } catch (e) { msg.className = 'import-msg err'; msg.textContent = e.message; }
}

async function doPullPp() {
  const msg = $('#pullMsg');
  msg.className = 'import-msg';
  try {
    const r = await api('/api/pp/pull', { method: 'POST', body: JSON.stringify({}) });
    if (r.started) await pollJob('/api/pp/pull/progress', msg, '正在从 osu! API 拉取官方 pp…');
    else msg.textContent = '任务已在运行中';
  } catch (e) { msg.className = 'import-msg err'; msg.textContent = '拉取失败：' + e.message; }
}

/* ---------------- 事件绑定 ---------------- */
$('#calPrev').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
$('#calNext').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
$('#calToday').addEventListener('click', () => { calMonth = new Date(); renderCalendar(); });
$('#drawerClose').addEventListener('click', closeDrawer);
$('#drawerMask').addEventListener('click', closeDrawer);

$('#statsRange').addEventListener('change', renderStats);

let debounceTimer = null;
const bindFilter = (sel, key) => $(sel).addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { playsState[key] = $(sel).value.trim(); playsState.offset = 0; renderPlays(); }, 300);
});
bindFilter('#fQ', 'q'); bindFilter('#fMods', 'mods'); bindFilter('#fMinPp', 'minPp');

// 点击表头排序，再点一次切换升/降序
document.querySelectorAll('#playsTable th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const s = th.dataset.sort;
    if (playsState.sort === s) playsState.dir = playsState.dir === 'desc' ? 'asc' : 'desc';
    else { playsState.sort = s; playsState.dir = 'desc'; }
    playsState.offset = 0;
    renderPlays();
  });
});

$('#btnImportRealm').addEventListener('click', doImportRealm);
$('#btnCalcPp').addEventListener('click', doCalcPp);
$('#btnExportCsv').addEventListener('click', () => window.open('/api/export/csv'));
$('#btnWarmupCovers').addEventListener('click', doWarmupCovers);
$('#btnSaveUsers').addEventListener('click', doSaveUsers);
$('#btnPurgeForeign').addEventListener('click', doPurgeForeign);
$('#btnSaveApi').addEventListener('click', doSaveApi);
$('#btnPullPp').addEventListener('click', doPullPp);
$('#mapBack').addEventListener('click', () => { location.hash = lastNonMapHash; });
$('#csvFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const msg = $('#csvMsg');
  msg.className = 'import-msg'; msg.textContent = '导入中…';
  try {
    const text = await f.text();
    const r = await api('/api/import/csv', { method: 'POST', body: text });
    msg.className = 'import-msg ok';
    msg.textContent = `导入完成：新增 ${r.ok} 条，跳过 ${r.skip} 条。`;
    refreshStatus();
  } catch (err) {
    msg.className = 'import-msg err'; msg.textContent = '导入失败：' + err.message;
  }
});
$('#btnClearCovers').addEventListener('click', async () => {
  const msg = $('#coversMsg');
  try {
    const r = await api('/api/covers/refresh', { method: 'POST' });
    msg.className = 'import-msg ok';
    msg.textContent = `已清空 ${r.cleared} 个封面缓存，刷新页面后重新拉取。`;
  } catch (e) { msg.className = 'import-msg err'; msg.textContent = e.message; }
});

/* ---------------- 轮询：成绩变化时自动刷新 ---------------- */
let lastCount = -1;
setInterval(async () => {
  try {
    const s = await api('/api/status');
    setDot('#dotTosu', s.tosu.connected);
    $('#lblTosu').textContent = s.tosu.connected ? 'tosu ✓' : 'tosu ✗';
    $('#lblGame').textContent = s.tosu.state || '—';
    if (s.db.count !== lastCount) {
      const changed = lastCount >= 0;
      lastCount = s.db.count;
      if (changed && !$('#view-cal').hidden) renderCalendar();
      if (changed && !$('#view-stats').hidden) renderStats();
    }
  } catch {}
}, 8000);

route();
