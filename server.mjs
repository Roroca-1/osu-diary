#!/usr/bin/env node
// osu-diary 服务器：tosu 监听 + SQLite 日记 + Web 界面 + 封面缓存
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { openDb, insertPlay, calendarMonth, dayPlays, playsQuery, stats, mapInfo,
         totalCount, lastPlay, deletePlay, exportRows } from './lib/db.mjs';
import { TosuClient } from './lib/tosu.mjs';
import { coverDir, coverFile, fetchCover } from './lib/covers.mjs';
import { importRealm } from './lib/importer/realm.mjs';
import { importCsv } from './lib/importer/csv.mjs';
import { fillPp, detectLazerFiles } from './lib/pp.mjs';
import { pullPpOnline } from './lib/pp-online.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dir, 'web');

import { loadConfig, saveConfig as persistConfig } from './lib/config.mjs';

/* ---------------- 装配 ---------------- */
export async function createServer(opts = {}) {
  const cfg = { ...loadConfig(), ...opts };
  const db = openDb(path.join(cfg.dataDir, 'diary.db'));
  const covers = coverDir(cfg.dataDir);
  fs.mkdirSync(covers, { recursive: true });

  const tosuStatus = { connected: false, state: '?' };
  let tosuClient = null;
  const coverFetching = new Set();          // 正在拉取的封面（去重）
  const jobs = {                            // 后台任务状态
    pp: { running: false, i: 0, total: 0, ok: 0, skip: 0, msg: '' },
    ppPull: { running: false, i: 0, total: 0, ok: 0, skip: 0, msg: '' },
    warmup: { running: false, i: 0, total: 0, ok: 0, msg: '' },
  };

  function saveConfig(patch) {
    Object.assign(cfg, patch);
    persistConfig(patch);
  }

  function startPpJob({ withPp = true } = {}) {
    if (jobs.pp.running) return false;
    jobs.pp = { running: true, i: 0, total: 0, ok: 0, skip: 0, msg: '开始…' };
    const filesDir = detectLazerFiles();
    (async () => {
      await new Promise(r => setImmediate(r)); // 先让 HTTP 响应返回
      try {
        const res = fillPp(db, {
          filesDir,
          withPp,
          log: (m) => { jobs.pp.msg = m; console.log('[pp]', m); },
          onProgress: (i, total, st) => { jobs.pp.i = i; jobs.pp.total = total; jobs.pp.ok = st.ok; jobs.pp.skip = st.noFile + st.daSkip + st.err; },
        });
        jobs.pp.ok = res.ok; jobs.pp.skip = res.noFile + res.daSkip + res.err; jobs.pp.total = res.total;
        jobs.pp.msg = `完成：${res.ok} 条获得 pp（无谱面文件 ${res.noFile}，lazer 专属 mods ${res.daSkip}，出错 ${res.err}）`;
      } catch (e) {
        jobs.pp.msg = '失败：' + e.message;
      } finally {
        jobs.pp.running = false;
      }
    })();
    return true;
  }

  function startPpPullJob(force = false) {
    if (jobs.ppPull.running) return false;
    const { clientId, clientSecret } = cfg.osuApi || {};
    const userId = cfg.osuUser?.id;
    jobs.ppPull = { running: true, i: 0, total: 0, ok: 0, skip: 0, msg: '开始…' };
    (async () => {
      await new Promise(r => setImmediate(r));
      try {
        const res = await pullPpOnline(db, {
          clientId, clientSecret, userId,
          base: process.env.OSU_API_BASE || undefined,
          force,
          log: (m) => { jobs.ppPull.msg = m; console.log('[pp-pull]', m); },
          onProgress: (i, total, st) => { jobs.ppPull.i = i; jobs.ppPull.total = total; jobs.ppPull.ok = st.ok; jobs.ppPull.skip = st.notFound + st.fail; },
        });
        jobs.ppPull.msg = `完成：${res.ok} 条更新为在线 pp；无匹配 ${res.notFound}；请求失败 ${res.fail}`;
      } catch (e) {
        jobs.ppPull.msg = '失败：' + e.message;
      } finally {
        jobs.ppPull.running = false;
      }
    })();
    return true;
  }

  function hasOnlineCreds() {
    return !!(cfg.osuApi?.clientId && cfg.osuApi?.clientSecret && cfg.osuUser?.id);
  }

  // 启动自检：历史成绩还没做 mods 换算（ar_orig 为空）时自动补做一次
  const needConv = db.prepare("SELECT COUNT(*) n FROM plays WHERE src LIKE 'realm%' AND ar_orig IS NULL").get().n;
  if (needConv > 100) {
    console.log(`[startup] 检测到 ${needConv} 条历史成绩未做 mods 换算，自动处理（AR/BPM/星级换算 + 补 pp）…`);
    startPpJob();
  }

  function startCoverWarmup() {
    if (jobs.warmup.running) return false;
    jobs.warmup = { running: true, i: 0, total: 0, ok: 0, msg: '开始…' };
    (async () => {
      await new Promise(r => setImmediate(r));
      try {
        const sets = db.prepare('SELECT DISTINCT set_id FROM plays WHERE set_id IS NOT NULL').all().map(r => r.set_id);
        jobs.warmup.total = sets.length;
        let ok = 0;
        const queue = [...sets];
        async function worker() {
          while (queue.length) {
            const id = queue.shift();
            const done = await fetchCover(covers, id, null).catch(() => false);
            if (done) ok++;
            jobs.warmup.i = sets.length - queue.length;
            jobs.warmup.ok = ok;
          }
        }
        await Promise.all(Array.from({ length: 8 }, () => worker()));
        jobs.warmup.msg = `完成：成功缓存 ${ok}/${sets.length} 张封面`;
      } catch (e) {
        jobs.warmup.msg = '失败：' + e.message;
      } finally {
        jobs.warmup.running = false;
      }
    })();
    return true;
  }

  if (cfg.tosuWs) {
    tosuClient = new TosuClient({
      wsUrl: cfg.tosuWs,
      log: (m) => console.log(m),
      onScore: (rec, frame) => {
        // 用户名筛选：看别人 replay 时不记录。
        // 名单来源：设置里手动填的 users > tosu 实时 profile > realm 导入识别的 selfName
        const live = String(frame?.profile?.name || '').trim();
        const allowed = String(cfg.users || '').split(',').map(s => s.trim()).filter(Boolean);
        const effective = allowed.length ? allowed : [...new Set([live, cfg.selfName].filter(Boolean))];
        if (rec.player && effective.length && !effective.includes(rec.player)) {
          console.log(`[score] 跳过（${rec.player} 不在记录名单 [${effective.join(', ')}]）`);
          return;
        }
        const res = insertPlay(db, rec);
        if (res.ok) {
          const t = new Date(rec.playedAt);
          console.log(`[score] ${t.toISOString()}  ${rec.artist || '?'} - ${rec.title || '?'} [${rec.version || ''}]  ` +
            `${rec.mods}  acc ${rec.acc?.toFixed(2)}%  pp ${rec.pp ?? '-'}  ${rec.nmiss ?? 0}miss`);
        } else {
          console.log(`[score] 跳过（${res.reason}）`);
        }
        // 后台预热封面（在线封面优先，本地背景兜底）
        const bg = frame?.directPath?.beatmapBackground || null;
        if (rec.setId) fetchCover(covers, rec.setId, bg).catch(() => {});
      },
    });
    tosuClient.on('status', (s) => { tosuStatus.connected = s.connected; });
    tosuClient.start();
  }

  /* ---------------- HTTP ---------------- */
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                 '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
                 '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

  function send(res, code, body, type = 'application/json; charset=utf-8') {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  }
  const json = (res, obj, code = 200) => send(res, code, JSON.stringify(obj));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = decodeURIComponent(url.pathname);

    try {
      /* ---- API ---- */
      if (p === '/api/status') {
        const last = lastPlay(db);
        return json(res, {
          tosu: { connected: tosuStatus.connected, state: tosuClient?.state || tosuStatus.state },
          db: { count: totalCount(db), lastPlay: last ? { playedAt: last.played_at, title: last.title, artist: last.artist, pp: last.pp } : null },
          coversDir: covers,
        });
      }
      if (p === '/api/calendar') {
        return json(res, calendarMonth(db, url.searchParams.get('month') || currentMonth()));
      }
      if (p === '/api/day') {
        const date = url.searchParams.get('date');
        if (!date) return json(res, { error: '缺少 date' }, 400);
        return json(res, dayPlays(db, date));
      }
      if (p === '/api/plays') {
        const q = url.searchParams;
        const nn = (k) => q.get(k) ? Number(q.get(k)) : null;
        return json(res, playsQuery(db, {
          from: nn('from'), to: nn('to'),
          q: q.get('q') || null,
          mods: q.get('mods') || null,
          minPp: nn('minPp'),
          arMin: nn('arMin'), arMax: nn('arMax'),
          bpmMin: nn('bpmMin'), bpmMax: nn('bpmMax'),
          sort: q.get('sort') || 'played_at',
          dir: q.get('dir') || 'desc',
          limit: Math.min(Number(q.get('limit') || 50), 500),
          offset: Number(q.get('offset') || 0),
        }));
      }
      if (p === '/api/stats') {
        const range = q2range(url.searchParams.get('range'));
        return json(res, stats(db, range));
      }
      if (p.startsWith('/api/cover/')) {
        const setId = Number(p.slice('/api/cover/'.length));
        const f = coverFile(covers, setId);
        if (f) {
          const buf = fs.readFileSync(f);
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' });
          return res.end(buf);
        }
        // 未缓存：现场拉取（并发去重），拿到就回，拿不到 404（前端显示占位）
        if (setId > 0) {
          let done = false;
          if (!coverFetching.has(setId)) {
            coverFetching.add(setId);
            const ok = await fetchCover(covers, setId, null).catch(() => false);
            coverFetching.delete(setId);
            done = ok;
          } else {
            // 等待正在进行的拉取
            for (let i = 0; i < 60 && !done; i++) {
              await new Promise(r => setTimeout(r, 250));
              if (coverFile(covers, setId)) done = true;
            }
          }
          const f2 = coverFile(covers, setId);
          if (f2) {
            const buf = fs.readFileSync(f2);
            res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' });
            return res.end(buf);
          }
        }
        return send(res, 404, 'no cover', 'text/plain');
      }
      if (p === '/api/import/realm' && req.method === 'POST') {
        const body = await readBody(req);
        const opts = {};
        try { const j = JSON.parse(body || '{}'); if (j.realmPath) opts.realmPath = j.realmPath; } catch {}
        // 允许保留的额外用户名（用户自己设置过名单时，里面的名字都保留）
        const keepNames = [...new Set([
          cfg.selfName,
          ...String(cfg.users || '').split(',').map(s => s.trim()),
        ].filter(Boolean))];
        const r = await importRealm(db, { ...opts, keepNames, tmpDir: cfg.dataDir, log: (m) => console.log('[realm]', m) });
        // 识别本人账号（用户名筛选 + 在线拉 pp 用）
        if (r.selfUser?.name) {
          saveConfig({
            selfName: r.selfUser.name,
            osuUser: { id: r.selfUser.id ?? cfg.osuUser?.id ?? null, name: r.selfUser.name },
          });
        }
        // 无论是否新增，都跑换算（已存在的行也要更新倍速/等效 AR）；有凭证则在线拉 pp
        const pullStarted = hasOnlineCreds() ? startPpPullJob() : false;
        const ppStarted = startPpJob({ withPp: !pullStarted });
        return json(res, { ...r, ppStarted, pullStarted });
      }
      if (p === '/api/map') {
        const md5 = url.searchParams.get('md5');
        if (!md5) return json(res, { error: '缺少 md5' }, 400);
        const info = mapInfo(db, md5);
        if (!info) return json(res, { error: '没有这张图' }, 404);
        return json(res, info);
      }
      if (p === '/api/import/pp' && req.method === 'POST') {
        return json(res, { started: startPpJob() });
      }
      if (p === '/api/import/pp/progress') {
        return json(res, jobs.pp);
      }
      if (p === '/api/pp/pull' && req.method === 'POST') {
        let force = false;
        try { force = !!JSON.parse(await readBody(req) || '{}').force; } catch {}
        return json(res, { started: startPpPullJob(force) });
      }
      if (p === '/api/pp/pull/progress') {
        return json(res, jobs.ppPull);
      }
      if (p === '/api/covers/warmup' && req.method === 'POST') {
        return json(res, { started: startCoverWarmup() });
      }
      if (p === '/api/covers/warmup/progress') {
        return json(res, jobs.warmup);
      }
      if (p === '/api/import/csv' && req.method === 'POST') {
        const raw = await readBody(req);
        // 支持原始 CSV 文本（content-type text/plain 或直接 body）
        const text = raw.includes('\n') ? raw : Buffer.from(raw, 'base64').toString('utf8');
        const tmp = path.join(cfg.dataDir, `import-${Date.now()}.csv`);
        fs.writeFileSync(tmp, text);
        const r = importCsv(db, tmp, { log: (m) => console.log('[csv]', m) });
        fs.unlinkSync(tmp);
        return json(res, r);
      }
      if (p === '/api/covers/refresh' && req.method === 'POST') {
        let n = 0;
        try { for (const f of fs.readdirSync(covers)) { fs.unlinkSync(path.join(covers, f)); n++; } } catch {}
        return json(res, { cleared: n });
      }
      if (p === '/api/export/csv') {
        const rows = exportRows(db);
        const head = 'played_at,artist,title,version,mods,ar,bpm,stars,acc,pp,grade,max_combo,miss,set_id,map_id,md5,ur,od,cs,hp\n';
        const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const body = head + rows.map(r => [
          new Date(r.played_at).toISOString(), r.artist, r.title, r.version, r.mods,
          r.ar, r.bpm, r.stars, r.acc, r.pp, r.grade, r.max_combo, r.nmiss,
          r.set_id, r.map_id, r.md5, r.ur, r.od, r.cs, r.hp
        ].map(esc).join(',')).join('\n');
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="osu-diary.csv"' });
        return res.end(body);
      }
      if (p === '/api/plays/purge-foreign' && req.method === 'POST') {
        // 删除已记录的非本人成绩（用户名筛选生效前录进去的旧数据）
        const allowed = String(cfg.users || '').split(',').map(s => s.trim()).filter(Boolean);
        const effective = allowed.length ? allowed : [cfg.selfName].filter(Boolean);
        if (!effective.length) return json(res, { deleted: 0, note: '未配置任何用户名，无从判断' });
        const marks = effective.map(() => '?').join(',');
        const r = db.prepare(`DELETE FROM plays WHERE player IS NOT NULL AND player NOT IN (${marks})`).run(...effective);
        return json(res, { deleted: r.changes, kept: effective });
      }
      if (p.startsWith('/api/plays/') && req.method === 'DELETE') {
        const id = Number(p.slice('/api/plays/'.length));
        return json(res, { deleted: deletePlay(db, id) });
      }
      if (p === '/api/config') {
        if (req.method === 'GET') {
          return json(res, {
            port: cfg.port, tosuWs: cfg.tosuWs, users: cfg.users || '',
            selfName: cfg.selfName || '',
            clientId: cfg.osuApi?.clientId || '', clientSecret: cfg.osuApi?.clientSecret || '',
            osuUserId: cfg.osuUser?.id ?? '', osuUserName: cfg.osuUser?.name || '',
          });
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          let patch = {};
          try { patch = JSON.parse(body || '{}'); } catch { return json(res, { error: 'JSON 无效' }, 400); }
          const next = {};
          if (typeof patch.users === 'string') next.users = patch.users;
          const osuApi = { ...(cfg.osuApi || {}) };
          if (typeof patch.clientId === 'string') osuApi.clientId = patch.clientId;
          if (typeof patch.clientSecret === 'string') osuApi.clientSecret = patch.clientSecret;
          next.osuApi = osuApi;
          if (patch.osuUserId !== undefined) {
            next.osuUser = { ...(cfg.osuUser || {}), id: patch.osuUserId ? Number(patch.osuUserId) : null };
          }
          saveConfig(next);
          return json(res, { ok: true });
        }
        return json(res, { error: '不支持的方法' }, 405);
      }

      /* ---- 静态页面 ---- */
      let file = p === '/' ? 'index.html' : p.slice(1);
      if (!file.includes('.')) file = 'index.html';
      const full = path.join(WEB_DIR, file);
      if (!full.startsWith(WEB_DIR) || !fs.existsSync(full)) return send(res, 404, 'not found', 'text/plain');
      const ext = path.extname(full).toLowerCase();
      return send(res, 200, fs.readFileSync(full), MIME[ext] || 'application/octet-stream');
    } catch (e) {
      console.error('[http]', e);
      return json(res, { error: e.message }, 500);
    }
  });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  return { server, db, cfg, covers, tosuClient, start: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  }) };
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function q2range(v) {
  if (v === 'all' || !v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------------- 直接运行时启动服务 ---------------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { start, cfg } = await createServer();
  await start();
  console.log(`osu-diary 已启动 → http://127.0.0.1:${cfg.port}`);
  console.log(`数据目录：${cfg.dataDir}`);
  console.log(`tosu：${cfg.tosuWs || '（未启用）'}`);
}
