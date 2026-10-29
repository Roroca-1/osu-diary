// osu-diary 数据层：SQLite（node:sqlite 内置，无第三方依赖）
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plays (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup         TEXT UNIQUE,
  played_at     INTEGER NOT NULL,      -- 真实成绩时间 unix ms
  logged_at     INTEGER NOT NULL,      -- 记录入库时间 unix ms
  set_id        INTEGER,               -- beatmapset id（封面用）
  map_id        INTEGER,
  md5           TEXT,
  file_hash     TEXT,                  -- lazer 存储 hash（files/{h[0]}/{h[0:2]}/{h}，pp 计算用）
  artist        TEXT, title TEXT, artist_uni TEXT, title_uni TEXT,
  version       TEXT, creator TEXT, source TEXT,
  mods          TEXT, mods_rate REAL, mods_settings TEXT,
  ar REAL, ar_orig REAL, od REAL, cs REAL, hp REAL,
  bpm REAL, bpm_min REAL, bpm_max REAL,
  stars REAL, length_ms INTEGER,
  acc REAL, pp REAL, pp_fc REAL, ur REAL,
  grade TEXT, perfect INTEGER,
  max_combo INTEGER, score INTEGER,
  n300 INTEGER, n100 INTEGER, n50 INTEGER, nmiss INTEGER, geki INTEGER, katu INTEGER,
  slider_breaks INTEGER, slider_end INTEGER,
  score_id INTEGER, ruleset TEXT,
  player TEXT, pp_source TEXT,
  src TEXT, raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_played_at ON plays(played_at);
CREATE INDEX IF NOT EXISTS idx_set ON plays(set_id);
CREATE INDEX IF NOT EXISTS idx_md5 ON plays(md5);
`;

const COLS = `dedup, played_at, logged_at, set_id, map_id, md5, file_hash,
  artist, title, artist_uni, title_uni, version, creator, source,
  mods, mods_rate, mods_settings, ar, ar_orig, od, cs, hp, bpm, bpm_min, bpm_max,
  stars, length_ms, acc, pp, pp_fc, ur, grade, perfect, max_combo, score,
  n300, n100, n50, nmiss, geki, katu, slider_breaks, slider_end,
  score_id, ruleset, player, pp_source, src, raw`;

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 5000 }); // 并发写时等待锁，最多 5 秒
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  // 迁移：老库补列
  const cols = db.prepare('PRAGMA table_info(plays)').all().map(c => c.name);
  if (!cols.includes('file_hash')) db.exec('ALTER TABLE plays ADD COLUMN file_hash TEXT');
  if (!cols.includes('mods_settings')) db.exec('ALTER TABLE plays ADD COLUMN mods_settings TEXT');
  if (!cols.includes('player')) db.exec('ALTER TABLE plays ADD COLUMN player TEXT');
  if (!cols.includes('pp_source')) db.exec('ALTER TABLE plays ADD COLUMN pp_source TEXT');
  return db;
}

/** 计算去重键：优先用线上成绩 id，否则用分数指纹 */
export function dedupKey(p) {
  if (p.scoreId > 0) return 's:' + p.scoreId;
  return ['p', p.md5 || '', p.score ?? '', p.n300 ?? '', p.n100 ?? '', p.n50 ?? '', p.nmiss ?? '', p.playedAt ?? ''].join('|');
}

/**
 * 写入一条成绩。返回 { ok, id } 或 { skipped, reason }。
 * 跨来源防重：无线上 id 的本地成绩，若已存在同 md5+score+时间的记录则跳过
 * （realm 回填与 tosu 回放观看可能都产生同一局）。
 */
export function insertPlay(db, p) {
  const dedup = p.dedup || dedupKey(p);
  if (!p.scoreId || p.scoreId <= 0) {
    if (p.md5 && p.score != null && p.playedAt) {
      const dup = db.prepare('SELECT id FROM plays WHERE md5=? AND score=? AND played_at=? LIMIT 1')
        .get(p.md5, p.score, p.playedAt);
      if (dup) return { skipped: true, reason: 'duplicate' };
    }
  }
  const st = db.prepare(`INSERT OR IGNORE INTO plays (${COLS})
    VALUES (${COLS.split(',').map(() => '?').join(',')})`);
  const now = Date.now();
  const res = st.run(
    dedup, p.playedAt ?? now, now,
    p.setId ?? null, p.mapId ?? null, p.md5 ?? null, p.fileHash ?? null,
    p.artist ?? null, p.title ?? null, p.artistUni ?? null, p.titleUni ?? null,
    p.version ?? null, p.creator ?? null, p.source ?? null,
    p.mods ?? null, p.modsRate ?? null, p.modsSettings ?? null,
    p.ar ?? null, p.arOrig ?? null, p.od ?? null, p.cs ?? null, p.hp ?? null,
    p.bpm ?? null, p.bpmMin ?? null, p.bpmMax ?? null,
    p.stars ?? null, p.lengthMs ?? null,
    p.acc ?? null, p.pp ?? null, p.ppFc ?? null, p.ur ?? null,
    p.grade ?? null, p.perfect ?? null,
    p.maxCombo ?? null, p.score ?? null,
    p.n300 ?? null, p.n100 ?? null, p.n50 ?? null, p.nmiss ?? null, p.geki ?? null, p.katu ?? null,
    p.sliderBreaks ?? null, p.sliderEnd ?? null,
    p.scoreId ?? null, p.ruleset ?? null,
    p.player ?? null, p.ppSource ?? null,
    p.src ?? null, p.raw ?? null
  );
  if (res.changes > 0) return { ok: true, id: Number(res.lastInsertRowid) };
  // 已存在：若是 tosu 带来的 pp 而旧记录没有，就补上 pp（realm 历史成绩常缺 pp）
  if (p.pp != null && p.pp > 0) {
    db.prepare(`UPDATE plays SET pp=COALESCE(pp, ?), pp_fc=COALESCE(pp_fc, ?), ur=COALESCE(ur, ?)
      WHERE dedup=? AND (pp IS NULL OR pp < ?)`).run(p.pp, p.ppFc ?? null, p.ur ?? null, dedup, p.pp);
  }
  return { skipped: true, reason: 'exists' };
}

/* ---------------- 查询 ---------------- */

const ROW_SELECT = `SELECT id, played_at, set_id, map_id, md5, artist, title, artist_uni, title_uni,
  version, creator, mods, mods_rate, ar, ar_orig, od, cs, hp, bpm, stars, length_ms,
  acc, pp, pp_fc, ur, grade, max_combo, score, n300, n100, n50, nmiss, geki, katu,
  slider_breaks, score_id, player, pp_source, src FROM plays`;

/** 月视图：每天的成绩数 + 当天最高 pp 的那一条 */
export function calendarMonth(db, monthStr /* YYYY-MM */) {
  const [y, m] = monthStr.split('-').map(Number);
  const from = new Date(y, m - 1, 1).getTime();
  const to = new Date(y, m, 1).getTime();

  const days = db.prepare(`
    SELECT date(played_at/1000,'unixepoch','localtime') d, COUNT(*) n, MAX(pp) toppp
    FROM plays WHERE played_at>=? AND played_at<? GROUP BY d`).all(from, to);

  const tops = db.prepare(`
    WITH r AS (SELECT *, ROW_NUMBER() OVER (
        PARTITION BY date(played_at/1000,'unixepoch','localtime')
        ORDER BY COALESCE(pp,-1) DESC, acc DESC) rn
      FROM plays WHERE played_at>=? AND played_at<?)
    SELECT id, played_at, set_id, map_id, artist, title, artist_uni, title_uni, version,
           mods, pp, acc, grade, nmiss, ar, bpm, stars
    FROM r WHERE rn=1`).all(from, to);

  const topsByDay = new Map(tops.map(t => [localDay(t.played_at), t]));
  return days.map(d => ({ day: d.d, count: d.n, topPp: d.toppp, top: topsByDay.get(d.d) || null }));
}

function localDay(ms) {
  const d = new Date(ms);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayRange(db, dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const to = from + 24 * 3600 * 1000;
  return { from, to };
}

export function dayPlays(db, dayStr) {
  const { from, to } = dayRange(db, dayStr);
  return db.prepare(`${ROW_SELECT} WHERE played_at>=? AND played_at<? ORDER BY COALESCE(pp,-1) DESC, acc DESC`).all(from, to);
}

export function playsQuery(db, { from, to, q, mods, minPp, arMin, arMax, bpmMin, bpmMax,
                                   sort = 'played_at', dir = 'desc', limit = 50, offset = 0 } = {}) {
  const cond = [];
  const args = [];
  if (from) { cond.push('played_at>=?'); args.push(from); }
  if (to) { cond.push('played_at<?'); args.push(to); }
  if (q) {
    cond.push('(artist LIKE ? OR title LIKE ? OR artist_uni LIKE ? OR title_uni LIKE ? OR version LIKE ? OR creator LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like, like, like);
  }
  if (mods) { cond.push('mods LIKE ?'); args.push(`%${mods}%`); }
  if (minPp != null) { cond.push('pp>=?'); args.push(minPp); }
  if (arMin != null) { cond.push('ar>=?'); args.push(arMin); }
  if (arMax != null) { cond.push('ar<?'); args.push(arMax); }
  if (bpmMin != null) { cond.push('bpm>=?'); args.push(bpmMin); }
  if (bpmMax != null) { cond.push('bpm<?'); args.push(bpmMax); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const orderBy = { played_at: 'played_at', pp: 'pp', acc: 'acc', stars: 'stars', bpm: 'bpm', ar: 'ar', nmiss: 'nmiss' }[sort] || 'played_at';
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const total = db.prepare(`SELECT COUNT(*) n FROM plays ${where}`).get(...args).n;
  const rows = db.prepare(`${ROW_SELECT} ${where} ORDER BY ${orderBy} ${direction} NULLS LAST LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);
  return { rows, total };
}

export function stats(db, rangeDays) {
  const from = rangeDays ? Date.now() - rangeDays * 86400000 : 0;
  const inRange = db.prepare('SELECT * FROM plays WHERE played_at>=?').all(from);

  const agg = {
    totalPlays: inRange.length,
    totalDays: new Set(inRange.map(p => localDay(p.played_at))).size,
    maxPp: null, maxAcc: null, avgAcc: null,
    playDays7: 0,
  };
  let accSum = 0, accN = 0;
  for (const p of inRange) {
    if (p.pp != null && (agg.maxPp == null || p.pp > agg.maxPp)) agg.maxPp = p.pp;
    if (p.acc != null && (agg.maxAcc == null || p.acc > agg.maxAcc)) agg.maxAcc = p.acc;
    if (p.acc != null) { accSum += p.acc; accN++; }
  }
  agg.avgAcc = accN ? accSum / accN : null;

  const since7 = Date.now() - 7 * 86400000;
  agg.playDays7 = db.prepare(`SELECT COUNT(DISTINCT date(played_at/1000,'unixepoch','localtime')) n
    FROM plays WHERE played_at>=?`).get(since7).n;
  agg.plays7 = db.prepare('SELECT COUNT(*) n FROM plays WHERE played_at>=?').get(since7).n;
  agg.setCount = db.prepare('SELECT COUNT(DISTINCT set_id) n FROM plays WHERE played_at>=? AND set_id IS NOT NULL').get(from).n;

  // 每日序列：数量 / 最高 pp / 平均 acc / 最高 acc
  const series = db.prepare(`
    SELECT date(played_at/1000,'unixepoch','localtime') d,
           COUNT(*) n, MAX(pp) toppp, AVG(acc) avgacc, MAX(acc) topacc
    FROM plays WHERE played_at>=? GROUP BY d ORDER BY d`).all(from);

  // AR 分布（等效 AR，0.1 精度分箱）
  const arRows = db.prepare(`SELECT ar FROM plays WHERE ar IS NOT NULL AND played_at>=?`).all(from);
  const arHist = {};
  for (const r of arRows) {
    const bin = Math.round(r.ar * 10) / 10;
    arHist[bin] = (arHist[bin] || 0) + 1;
  }

  // BPM 分布（10 bpm 分箱，四舍五入）
  const bpmRows = db.prepare(`SELECT bpm FROM plays WHERE bpm IS NOT NULL AND bpm>0 AND played_at>=?`).all(from);
  const bpmHist = {};
  for (const r of bpmRows) {
    const bin = Math.round(r.bpm / 10) * 10;
    bpmHist[bin] = (bpmHist[bin] || 0) + 1;
  }

  // mods 统计
  const modRows = db.prepare(`SELECT mods FROM plays WHERE mods IS NOT NULL AND played_at>=?`).all(from);
  const modCounts = {};
  for (const r of modRows) {
    const list = String(r.mods).split(',').map(s => s.trim()).filter(Boolean);
    for (const mod of list.length ? list : ['NM']) modCounts[mod] = (modCounts[mod] || 0) + 1;
  }

  // 串速散点：bpm × acc（限制条数）
  const stream = db.prepare(`SELECT bpm, acc, stars, played_at FROM plays
    WHERE bpm IS NOT NULL AND acc IS NOT NULL AND bpm>0 AND played_at>=? ORDER BY played_at DESC LIMIT 6000`).all(from);

  // pp 散点
  const ppSeries = db.prepare(`SELECT played_at, pp, acc, set_id, artist, title, version, mods, grade FROM plays
    WHERE pp IS NOT NULL AND played_at>=? ORDER BY played_at ASC LIMIT 6000`).all(from);

  return { agg, series, arHist, bpmHist, modCounts, stream, ppSeries };
}

/** 谱面页：某 md5 的谱面信息 + 全部成绩 + 同图集其他难度 */
export function mapInfo(db, md5) {
  const map = db.prepare(`SELECT set_id, map_id, md5, artist, artist_uni, title, title_uni, version,
    creator, source, ar, ar_orig, od, cs, hp, bpm, stars, length_ms
    FROM plays WHERE md5=? ORDER BY played_at DESC LIMIT 1`).get(md5);
  if (!map) return null;
  const plays = db.prepare(`${ROW_SELECT} WHERE md5=? ORDER BY COALESCE(pp,-1) DESC, acc DESC`).all(md5);
  const agg = db.prepare(`SELECT COUNT(*) n, MAX(pp) toppp, MAX(acc) topacc, AVG(acc) avgacc,
    MIN(played_at) first, MAX(played_at) last FROM plays WHERE md5=?`).get(md5);
  // 同图集其他难度（每难度取最高 pp）
  let diffs = [];
  if (map.set_id) {
    diffs = db.prepare(`
      WITH r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY md5 ORDER BY COALESCE(pp,-1) DESC, acc DESC) rn
        FROM plays WHERE set_id=? AND md5 IS NOT NULL)
      SELECT md5, version, stars, ar, bpm, pp, acc, grade, COUNT(*) OVER (PARTITION BY md5) n
      FROM r WHERE rn=1 ORDER BY COALESCE(pp,-1) DESC`).all(map.set_id);
  }
  return { map, plays, agg, diffs };
}

export function totalCount(db) {
  return db.prepare('SELECT COUNT(*) n FROM plays').get().n;
}

export function lastPlay(db) {
  return db.prepare(`${ROW_SELECT} ORDER BY played_at DESC LIMIT 1`).get();
}

export function deletePlay(db, id) {
  return db.prepare('DELETE FROM plays WHERE id=?').run(id).changes > 0;
}

export function exportRows(db) {
  return db.prepare(`${ROW_SELECT} ORDER BY played_at ASC`).all();
}

export { localDay };
