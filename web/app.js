/* osu-diary 前端：日历 / 统计 / 成绩列表 / 设置 */
'use strict';
const I = window.DiaryI18n, t = I.t;
I.apply();

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  let r;
  try { r = await fetch(path, { headers: opts.body ? { 'content-type': 'text/plain' } : {}, ...opts }); }
  catch { throw Object.assign(new Error(t('REQUEST_FAILED')), {messageKey:'REQUEST_FAILED'}); }
  let body;
  try { body = await r.json(); }
  catch { throw Object.assign(new Error(t('REQUEST_FAILED')), {messageKey:'REQUEST_FAILED'}); }
  if (!r.ok) throw Object.assign(new Error(t(body.code || 'REQUEST_FAILED',body.params)), {messageKey:body.code || 'REQUEST_FAILED',params:body.params || {}});
  return body;
}
const errorValue = e => e.messageKey ? {messageKey:e.messageKey,params:e.params || {}} : e.message;
const fmt = {
  n: (v, d = 2) => v == null ? '—' : I.number(v, d),
  acc: v => v == null ? '—' : I.number(v, 2) + '%',
  pp: v => v == null ? '—' : I.number(Math.round(v)) + 'pp',
  time: ms => I.date(ms, { hour: '2-digit', minute: '2-digit' }),
  day: ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; },
  dt: ms => ms == null ? '—' : I.date(ms, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }),
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
  let pills = (list.length ? list : ['NM']).map(m => `<span class="pill">${esc(/^[A-Z][A-Z0-9]{0,3}$/.test(m) ? m : t('Unknown mod'))}</span>`).join('');
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
  $('#calTitle').textContent = I.date(calMonth, {year:'numeric',month:'long'});
  let data;
  try { data = await api(`/api/calendar?month=${m}`); } catch (e) { $('#calGrid').innerHTML = `<div class="empty-hint">${esc(t('Load failed: {error}', {error:errorValue(e)}))}</div>`; return; }

  const byDay = new Map(data.map(d => [d.day, d]));
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // 周一开头

  let html = '';
  for (const w of Array.from({length:7}, (_, i) => I.date(new Date(2024,0,1+i), {weekday:'short'}))) html += `<div class="cal-dow">${w}</div>`;
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
      <div class="cal-count">${t('{count} plays',{count:info.count})}</div>
      <div class="cal-bottom">
        <div><span class="cal-pp">${top.pp != null ? fmt.pp(top.pp) : fmt.acc(top.acc)}</span>
        <span class="cal-acc">${top.acc != null ? I.number(top.acc,1) + '%' : ''}</span></div>
        <div class="cal-title">${esc(nm.title || nm.full)}${top.version ? ` <span style="opacity:.7">[${esc(top.version)}]</span>` : ''}</div>
      </div>
    </div>`;
  }
  $('#calGrid').innerHTML = html;
  $('#calSummary').textContent = t('{plays} plays · {days} active days this month',{plays:data.reduce((s,x)=>s+x.count,0),days:data.length});

  $('#calGrid').querySelectorAll('.cal-cell[data-day]').forEach(cell => {
    cell.addEventListener('click', () => openDrawer(cell.dataset.day));
  });
}

/* ---------------- 抽屉 ---------------- */
let drawerDay = null;
async function openDrawer(day) {
  drawerDay = day;
  const [year,month,date] = day.split('-').map(Number);
  $('#drawerTitle').textContent = I.date(new Date(year,month-1,date,12),{dateStyle:'long'});
  $('#drawerBody').innerHTML = `<div class="empty-hint">${t('Loading…')}</div>`;
  $('#drawer').hidden = false;
  $('#drawerMask').hidden = false;
  let rows;
  try { rows = await api(`/api/day?date=${day}`); } catch (e) { $('#drawerBody').innerHTML = `<div class="empty-hint">${esc(e.message)}</div>`; return; }

  const sumPp = rows.reduce((s, r) => s + (r.pp || 0), 0);
  const best = rows.slice().sort((a, b) => (b.pp || 0) - (a.pp || 0))[0];
  const accuracies = rows.map(r=>r.acc).filter(v=>v!=null), bestAccuracy = accuracies.length ? Math.max(...accuracies) : null;
  $('#drawerBody').innerHTML = `
    <div class="day-stat">${t('{count} plays · Best {pp} · Best accuracy {acc}',{count:rows.length,pp:fmt.pp(best?.pp),acc:fmt.acc(bestAccuracy)})}<br>${t('Sum of play pp: {pp} (not account pp)',{pp:fmt.pp(sumPp)})}</div>
    ${rows.map(r => {
      const nm = displayName(r);
      const mlink = mapLink(r);
      const osu = osuDirectUrl(r);
      const web = webUrl(r);
      return `<div class="play-row">
        ${coverHtml(r, 'thumb')}
        <div class="info">
          <div class="t">${mlink ? `<a href="${mlink}" style="color:inherit;text-decoration:none">${esc(nm.full)}</a>` : esc(nm.full)}</div>
          <div class="d">${fmt.time(r.played_at)} · ${modsPills(r.mods, r.mods_rate)} · AR ${fmt.n(r.ar, 1)} · ${fmt.n(r.bpm, 1)}bpm · ${fmt.n(r.stars, 2)}★ ${osu ? `<a class="ext" href="${osu}">${t('Open in game')}</a>` : ''} ${web ? `<a class="ext" href="${web}" target="_blank">${t('Website')}</a>` : ''}</div>
        </div>
        <div class="nums">
          <div class="pp">${fmt.pp(r.pp)}</div>
          <div>${fmt.acc(r.acc)} <span class="${gradeCls(r.grade)}">${esc(r.grade || '')}</span> ${r.nmiss ? `<span style="color:var(--bad)">${r.nmiss}×</span>` : ''}</div>
        </div>
        <button class="del" data-id="${r.id}" title="${t('Delete this score')}" aria-label="${t('Delete this score')}">✕</button>
      </div>`;
    }).join('')}
  `;
  $('#drawerBody').querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('Delete this score?'))) return;
      await api(`/api/plays/${btn.dataset.id}`, { method: 'DELETE' });
      openDrawer(day);
      renderCalendar();
    });
  });
}
function closeDrawer() { drawerDay = null; $('#drawer').hidden = true; $('#drawerMask').hidden = true; }

/* Statistics rendering is shared by locale and control changes. */
let statsData = null, statsRequest = 0, selectedBuckets = { ar: null, bpm: null };
for (const id of ['statsRange','accuracyScale','chartArMode','chartArStep','chartBpmMode','chartBpmStep']) {
  const saved = I.storage.get('osu-diary.' + id);
  if (saved && [...$('#'+id).options].some(o=>o.value===saved)) $('#'+id).value = saved;
}
async function renderStats() {
  const request = ++statsRequest;
  const query = new URLSearchParams({range:$('#statsRange').value,arStep:$('#chartArStep').value,bpmStep:$('#chartBpmStep').value});
  try {
    const s = await api('/api/stats?' + query);
    if (request !== statsRequest) return;
    statsData = s; drawStats();
  } catch (e) {
    if (request === statsRequest) for (const id of ['chartPp','chartAcc','chartStream','chartAr','chartBpm','chartMods']) $('#'+id).textContent = t('Load failed: {error}',{error:errorValue(e)});
  }
}
function drawStats() {
  if (!statsData) return;
  const s = statsData, a = s.agg;
  const kpi = (key,value,detail='') => `<div class="kpi"><div class="k">${t(key)}</div><div class="v">${value}</div><div class="d">${detail}</div></div>`;
  $('#kpis').innerHTML = kpi('Total scores',I.number(a.totalPlays),t('In selected range')) + kpi('Days played',I.number(a.totalDays),t('{count} days played in the last 7 days',{count:a.playDays7})) + kpi('Last 7 days',I.number(a.plays7),t('Plays')) + kpi('Best play pp',fmt.pp(a.maxPp)) + kpi('Average accuracy',fmt.acc(a.avgAcc)) + kpi('Beatmap sets',I.number(a.setCount));
  window.DiaryCharts.render(s, {fullAccuracy:$('#accuracyScale').value==='full', arMode:$('#chartArMode').value,bpmMode:$('#chartBpmMode').value,onBucket:openBucket, onPlay:p=>{if(p.md5) gotoMap(p.md5);}});
  for (const metric of ['ar','bpm']) {
    const bucket = s[metric+'Buckets'].find(b=>b.lower===selectedBuckets[metric]);
    if (bucket) openBucket(metric,bucket); else {selectedBuckets[metric]=null; $('#chart'+(metric==='ar'?'Ar':'Bpm')+'Detail').innerHTML='';}
  }
  const entries = Object.entries(s.modCounts).sort((a,b)=>b[1]-a[1]).slice(0,10), max = Math.max(1,...entries.map(e=>e[1]));
  $('#chartMods').innerHTML = entries.map(([mod,n])=>`<div class="mod-row"><span>${esc(mod==='UNKNOWN'?t('Unknown mod'):mod)}</span><div class="mod-track"><div style="width:${n/max*100}%"></div></div><b>${I.number(n)}</b></div>`).join('') || `<div class="empty-hint">${t('No data in this range')}</div>`;
}
async function openBucket(metric,bucket) {
  selectedBuckets[metric] = bucket.lower;
  const el = $('#chart'+(metric==='ar'?'Ar':'Bpm')+'Detail');
  const query = new URLSearchParams({from:statsData.range.from,to:statsData.range.to,limit:50,sort:'pp',dir:'desc'});
  query.set(metric+'Min',bucket.lower); query.set(metric+'Max',bucket.upper);
  const signature = query.toString(); el.dataset.query = signature;
  el.textContent = t('Loading…');
  try {
    const data = await api('/api/plays?'+signature);
    if (el.dataset.query !== signature) return;
    el.innerHTML = `<div class="hint">${t('{count} matching scores · Showing the first 50',{count:data.total})}</div><div class="tblwrap bucket-table"><table><thead><tr>${['Date','Beatmap','mods','Accuracy','pp','Misses'].map(k=>`<th>${t(k)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(r=>`<tr><td>${fmt.dt(r.played_at)}</td><td>${r.md5?`<a href="${mapLink(r)}">${esc(displayName(r).full)}</a>`:esc(displayName(r).full)}</td><td>${modsPills(r.mods,r.mods_rate)}</td><td>${fmt.acc(r.acc)}</td><td>${fmt.pp(r.pp)}</td><td>${r.nmiss??0}</td></tr>`).join('')}</tbody></table></div>`;
  } catch(e) { el.textContent=t('Load failed: {error}',{error:errorValue(e)}); }
}

/* ---------------- 成绩列表 ---------------- */
let playsState = { q: '', mods: '', minPp: '', sort: 'played_at', dir: 'desc', offset: 0, limit: 50 };

async function renderPlays() {
  const p = new URLSearchParams({ sort: playsState.sort, dir: playsState.dir, limit: playsState.limit, offset: playsState.offset });
  if (playsState.q) p.set('q', playsState.q);
  if (playsState.mods) p.set('mods', playsState.mods);
  if (playsState.minPp) p.set('minPp', playsState.minPp);
  let data;
  try { data = await api(`/api/plays?${p}`); } catch (e) { $('#playsTable tbody').innerHTML=`<tr><td colspan="10" class="empty-hint">${esc(t('Load failed: {error}',{error:errorValue(e)}))}</td></tr>`; return; }
  $('#playsTotal').textContent = t('{count} scores',{count:data.total});
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
  }).join('') || `<tr><td colspan="10" class="empty-hint">${t('No data in this range')}</td></tr>`;

  // 排序指示
  document.querySelectorAll('#playsTable th.sortable').forEach(th => {
    const el = th.querySelector('.sdir');
    if (el) el.textContent = th.dataset.sort === playsState.sort ? (playsState.dir === 'asc' ? '▲' : '▼') : '';
  });

  const pages = Math.ceil(data.total / playsState.limit);
  const cur = Math.floor(playsState.offset / playsState.limit) + 1;
  $('#playsPager').innerHTML = `
    <button class="ghost" id="pgPrev" ${playsState.offset === 0 ? 'disabled' : ''}>‹ ${t('Previous')}</button>
    <button class="ghost" id="pgNext" ${playsState.offset + playsState.limit >= data.total ? 'disabled' : ''}>${t('Next')} ›</button>
    <span class="info">${t('Page {page} of {pages}',{page:cur,pages:Math.max(1,pages)})}</span>`;
  $('#pgPrev')?.addEventListener('click', () => { playsState.offset = Math.max(0, playsState.offset - playsState.limit); renderPlays(); });
  $('#pgNext')?.addEventListener('click', () => { playsState.offset += playsState.limit; renderPlays(); });
}

/* ---------------- 设置 / 状态 ---------------- */
function setMessage(el,key,params={}) { el.dataset.i18n=key; el.dataset.i18nParams=JSON.stringify(params); el.textContent=t(key,params); }
async function refreshStatus() {
  try {
    const s=await api('/api/status'); setDot('#dotTosu',s.tosu.connected);
    $('#lblTosu').textContent=s.tosu.connected?'tosu ✓':'tosu ✗'; $('#lblGame').textContent=s.tosu.state||'—';
    setDot('#dotGame',!!s.tosu.state && s.tosu.state!=='?');
    $('#statusLine').textContent=t('Database: {count} scores',{count:s.db.count}) + (s.db.lastPlay?' · '+t('Latest play: {date}',{date:fmt.dt(s.db.lastPlay.playedAt)})+' '+s.db.lastPlay.artist+' - '+s.db.lastPlay.title+' '+fmt.pp(s.db.lastPlay.pp):'');
  } catch(e) {$('#statusLine').textContent=t('Service unavailable: {error}',{error:errorValue(e)});}
}
function setDot(sel,on) { $(sel).classList.toggle('on',!!on); $(sel).classList.toggle('off',!on); }
async function doImportRealm() {
  const btn=$('#btnImportRealm'),msg=$('#realmMsg'); btn.disabled=true; msg.className='import-msg';
  setMessage(msg,'Importing history… Close osu!lazer if its database is locked.');
  try {
    const r=await api('/api/import/realm',{method:'POST',body:'{}'});
    msg.className='import-msg ok'; setMessage(msg,'Imported {ok} scores; skipped {skip}.',r);
    if(r.ppStarted) await pollJob('/api/import/pp/progress',msg,'Calculating historical pp…');
    if(r.pullStarted) await pollJob('/api/pp/pull/progress',msg,'Refreshing official pp…');
    refreshStatus();renderCalendar();loadSettings();
  } catch(e) {msg.className='import-msg err';setMessage(msg,'Import failed: {error}',{error:errorValue(e)});}
  finally {btn.disabled=false;}
}
async function startJob(path,msg,label,progress) {
  msg.className='import-msg'; setMessage(msg,label);
  try {const r=await api(path,{method:'POST',body:'{}'});if(r.started)await pollJob(progress,msg,label);else setMessage(msg,'A job is already running');}
  catch(e){msg.className='import-msg err';setMessage(msg,'Load failed: {error}',{error:errorValue(e)});}
}
function doCalcPp(){return startJob('/api/import/pp',$('#realmMsg'),'Calculating historical pp…','/api/import/pp/progress');}
function doPullPp(){return startJob('/api/pp/pull',$('#pullMsg'),'Refreshing official pp…','/api/pp/pull/progress');}
function doWarmupCovers(){return startJob('/api/covers/warmup',$('#coversMsg'),'Preloading covers…','/api/covers/warmup/progress');}

/** 轮询后台任务直到完成 */
async function pollJob(url,msgEl,label) {
  for (;;) {
    await new Promise(r=>setTimeout(r,500));
    let s;try{s=await api(url);}catch(e){msgEl.className='import-msg err';setMessage(msgEl,'Load failed: {error}',{error:errorValue(e)});break;}
    if(s.running){setMessage(msgEl,label);if(s.total)msgEl.textContent+=` (${I.number(s.i)}/${I.number(s.total)})`;}
    else {msgEl.className=s.status==='error'?'import-msg err':'import-msg ok';setMessage(msgEl,s.messageKey||'job_idle',s.params||{});break;}
  }
}

/* ---------------- 谱面页 ---------------- */
async function renderMap(md5) {
  const body = $('#mapBody');
  if (!md5) { body.innerHTML = `<div class="empty-hint">${t('MAP_REQUIRED')}</div>`; return; }
  let info;
  try { info = await api(`/api/map?md5=${encodeURIComponent(md5)}`); }
  catch (e) { body.innerHTML = `<div class="empty-hint">${esc(t('Load failed: {error}', {error:errorValue(e)}))}</div>`; return; }

  const m = info.map;
  const nm = displayName(m);
  const osu = osuDirectUrl(m);
  const web = webUrl(m);
  $('#mapLinks').innerHTML =
    (osu ? `<a class="ext" href="${osu}">🎮 ${t('Open in game')}</a>` : '') +
    (web ? ` <a class="ext" href="${web}" target="_blank">🌐 ${t('Website')}</a>` : '');

  const stat = (k, v) => `<div class="mstat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  body.innerHTML = `
    <div class="panel map-head">
      <div class="map-cover">${coverHtml(m, 'thumb big')}</div>
      <div class="map-info">
        <div class="map-title">${esc(nm.full)}</div>
        <div class="mut small">${t('Mapper')}: ${esc(m.creator || '—')}${m.source ? ` · ${t('Source')}: ${esc(m.source)}` : ''} · ${t('Length')} ${fmtLength(m.length_ms)}</div>
        <div class="mstats">
          ${stat('AR', fmt.n(m.ar, 1))}${stat('OD', fmt.n(m.od, 1))}${stat('CS', fmt.n(m.cs, 1))}${stat('HP', fmt.n(m.hp, 1))}
          ${stat('BPM', fmt.n(m.bpm, 1))}${stat('★', fmt.n(m.stars, 2))}
        </div>
      </div>
    </div>
    <div class="panel">
      <h2>${t('Score history ({count})',{count:info.agg.n})}</h2>
      <div class="hint">${t('Best {pp} · Best accuracy {best} · Average {average} · First {first} · Latest {last}',{pp:fmt.pp(info.agg.toppp),best:fmt.acc(info.agg.topacc),average:fmt.acc(info.agg.avgacc),first:fmt.dt(info.agg.first),last:fmt.dt(info.agg.last)})}</div>
      <div class="tblwrap" style="max-height:420px"><table>
        <thead><tr><th>${t('Date')}</th><th>mods</th><th class="n">AR</th><th class="n">acc</th><th class="n">pp</th><th>${t('Grade')}</th><th class="n">${t('Misses')}</th><th class="n">${t('Combo')}</th></tr></thead>
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
      <h2>${t('Other difficulties')}</h2>
      <div class="hint">${t('Click to switch difficulty')}</div>
      <div class="diff-grid">
        ${info.diffs.map(d => {
          const cur = d.md5 === md5;
          return `<div class="diff-cell ${cur ? 'cur' : ''}" data-md5="${esc(d.md5)}">
            <div class="t">[${esc(d.version)}]</div>
            <div class="d">★${fmt.n(d.stars, 2)} · AR ${fmt.n(d.ar, 1)} · ${fmt.n(d.bpm, 1)}bpm</div>
            <div class="d">${t('Best {pp} · {acc} · {count} plays',{pp:fmt.pp(d.pp),acc:fmt.acc(d.acc),count:d.n})}</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
  `;
  body.querySelectorAll('.diff-cell').forEach(c => {
    c.addEventListener('click', () => gotoMap(c.dataset.md5));
  });
}

/* ---------------- 设置 ---------------- */
let settingsCache=null;
function renderSelfInfo(){const c=settingsCache;if(c)$('#selfInfo').textContent=c.selfName?t('Detected player: {name} (ID {id})',{name:c.selfName,id:c.osuUserId||'—'}):'';}
async function loadSettings(){try{const c=await api('/api/config');settingsCache=c;$('#cfgUsers').value=c.users||'';$('#cfgClientId').value=c.clientId||'';$('#cfgClientSecret').value=c.clientSecret||'';$('#cfgOsuUserId').value=c.osuUserId||'';renderSelfInfo();}catch(e){$('#selfInfo').textContent=e.message;}}
async function doSaveUsers(){const msg=$('#usersMsg');try{await api('/api/config',{method:'PUT',body:JSON.stringify({users:$('#cfgUsers').value.trim()})});msg.className='import-msg ok';setMessage(msg,$('#cfgUsers').value.trim()?'Saved':'Automatic player filter enabled');}catch(e){msg.className='import-msg err';setMessage(msg,'Load failed: {error}',{error:errorValue(e)});}}
async function doPurgeForeign(){const msg=$('#usersMsg');if(!confirm(t('Delete all other players’ scores? This cannot be undone.')))return;try{const r=await api('/api/plays/purge-foreign',{method:'POST'});msg.className='import-msg ok';setMessage(msg,r.deleted?'Removed {count} scores from other players.':(r.code||'No scores need removing'),{count:r.deleted});refreshStatus();renderCalendar();}catch(e){msg.className='import-msg err';setMessage(msg,'Load failed: {error}',{error:errorValue(e)});}}
async function doSaveApi(){const msg=$('#pullMsg');try{await api('/api/config',{method:'PUT',body:JSON.stringify({clientId:$('#cfgClientId').value.trim(),clientSecret:$('#cfgClientSecret').value.trim(),osuUserId:$('#cfgOsuUserId').value.trim()})});msg.className='import-msg ok';setMessage(msg,'Credentials saved');}catch(e){msg.className='import-msg err';setMessage(msg,'Load failed: {error}',{error:errorValue(e)});}}

/* ---------------- 事件绑定 ---------------- */
$('#calPrev').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
$('#calNext').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
$('#calToday').addEventListener('click', () => { calMonth = new Date(); renderCalendar(); });
$('#drawerClose').addEventListener('click', closeDrawer);
$('#drawerMask').addEventListener('click', closeDrawer);

for(const id of ['statsRange','accuracyScale','chartArMode','chartArStep','chartBpmMode','chartBpmStep']) $('#'+id).addEventListener('change',()=>{I.storage.set('osu-diary.'+id,$('#'+id).value);if(['accuracyScale','chartArMode','chartBpmMode'].includes(id))drawStats();else renderStats();});
$('#language').addEventListener('change',()=>{
  I.setLanguage($('#language').value); renderSelfInfo(); window.DiaryCharts.hideTip();
  const view=location.hash.split('?')[0];
  if(view==='#settings')refreshStatus();else if(view==='#stats'){if(statsData)drawStats();else renderStats();}else if(view==='#plays')renderPlays();else if(view==='#map')renderMap(new URLSearchParams(location.hash.split('?')[1]).get('md5'));else renderCalendar();
  if(drawerDay)openDrawer(drawerDay);
});
if(typeof ResizeObserver!=='undefined'){let timer;new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!$('#view-stats').hidden)drawStats();},100);}).observe($('#view-stats'));}

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
  msg.className = 'import-msg'; setMessage(msg,'Importing CSV…');
  try {
    const text = await f.text();
    const r = await api('/api/import/csv', { method: 'POST', body: text });
    msg.className = 'import-msg ok';
    setMessage(msg,'Imported {ok} scores; skipped {skip}.',r);
    refreshStatus();
  } catch (err) {
    msg.className = 'import-msg err'; setMessage(msg,'Import failed: {error}',{error:errorValue(err)});
  }
});
$('#btnClearCovers').addEventListener('click', async () => {
  const msg = $('#coversMsg');
  try {
    const r = await api('/api/covers/refresh', { method: 'POST' });
    msg.className = 'import-msg ok';
    setMessage(msg,'Cleared {count} cached covers. They will load again when needed.',{count:r.cleared});
  } catch (e) { msg.className = 'import-msg err'; setMessage(msg,'Load failed: {error}',{error:errorValue(e)}); }
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
