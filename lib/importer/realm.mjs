// 从 lazer 的 client.realm 回填完整历史成绩
// （真实日期 + mods 自定义倍速 speed_change + 本人账号识别 + 他人成绩过滤/清理）
// 依赖 realm 包（仅本模块动态加载，服务器主进程不依赖它）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { insertPlay } from '../db.mjs';

/** 自动探测 realm 路径：storage.ini 的自定义 FullPath 优先 */
export function detectRealmPath() {
  const candidates = [];
  const ini = path.join(os.homedir(), '.local/share/osu/storage.ini');
  try {
    const txt = fs.readFileSync(ini, 'utf8');
    const m = txt.match(/^\s*FullPath\s*=\s*(.+)$/m);
    if (m) candidates.push(path.join(m[1].trim(), 'client.realm'));
  } catch {}
  candidates.push(path.join(os.homedir(), '.local/share/osu/client.realm'));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

const g = (o, k) => (o && typeof o === 'object' && k in o ? o[k] : undefined);
const str = (v) => (v === null || v === undefined ? '' : String(v));
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const r3 = (v) => (v === null || v === undefined ? null : Math.round(v * 1000) / 1000);

/**
 * 解析 Score.Mods JSON：
 * - mods：逗号分隔的缩写（如 DT,HD）
 * - speedChange：DT/NC/HT 的自定义倍速（lazer 序列化为 settings.speed_change，默认倍速不写）
 * - hasSettings：是否带 settings（决定是否整段存进 mods_settings）
 */
function parseModsInfo(modsRaw) {
  const out = { mods: 'NM', speedChange: null, hasSettings: false };
  let arr = null;
  if (typeof modsRaw === 'string') {
    try { arr = JSON.parse(modsRaw); } catch { return out; }
  } else if (modsRaw && typeof modsRaw === 'object') {
    arr = Array.from({ length: modsRaw.length }, (_, i) => modsRaw[i]);
  }
  if (!Array.isArray(arr)) return out;
  const names = [];
  for (const m of arr) {
    if (m && typeof m === 'object') {
      const acr = m.acronym || m.Acronym || '';
      if (acr) names.push(acr);
      const s = m.settings;
      if (s && typeof s === 'object') {
        out.hasSettings = true;
        if ((acr === 'DT' || acr === 'NC' || acr === 'HT') && typeof s.speed_change === 'number' && s.speed_change > 0) {
          out.speedChange = s.speed_change;
        }
      }
    } else if (m) names.push(String(m));
  }
  out.mods = names.filter(Boolean).join(',') || 'NM';
  return out;
}

function toMs(d) {
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number') return d > 1e12 ? d : d * 1000;
  if (typeof d === 'string') { const m = Date.parse(d); return Number.isNaN(m) ? null : m; }
  return null;
}

// lazer ScoreRank 数值枚举（若 realm 存的是数字）
const RANK_NUM = { 0: 'D', 1: 'C', 2: 'B', 3: 'A', 4: 'S', 5: 'SH', 6: 'X', 7: 'XH', '-1': 'F' };

export async function importRealm(db, { realmPath, tmpDir, keepNames = [], log = () => {} } = {}) {
  const src = realmPath || detectRealmPath();
  if (!src) throw new Error('找不到 lazer 的 client.realm（请手动指定路径）');
  if (!fs.existsSync(src)) throw new Error(`realm 文件不存在: ${src}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const copy = path.join(tmpDir, `client-copy-${Date.now()}.realm`);
  log(`复制 realm (${(fs.statSync(src).size / 1048576).toFixed(0)} MB)…`);
  fs.copyFileSync(src, copy);

  const Realm = (await import('realm')).default;
  const realm = await Realm.open({ path: copy, readOnly: true, disableFormatUpgrade: true });
  try {
    return doImport(db, realm, log, keepNames);
  } finally {
    realm.close();
    try { fs.unlinkSync(copy); } catch {}
  }
}

function doImport(db, realm, log, keepNames) {
  // ---- Beatmap 索引：ID(GUID) → 谱面信息 ----
  const mapIdx = new Map();
  for (const bm of realm.objects('Beatmap')) {
    const meta = bm.Metadata || {};
    const set = bm.BeatmapSet || {};
    const diff = bm.BeatmapDifficulty || bm.Difficulty || {};
    mapIdx.set(str(bm.ID), {
      md5: str(bm.MD5Hash || bm.BeatmapHash || ''),
      fileHash: str(bm.Hash || ''),
      setId: (g(set, 'OnlineID') ?? -1) > 0 ? g(set, 'OnlineID') : null,
      mapId: (g(bm, 'OnlineID') ?? -1) > 0 ? g(bm, 'OnlineID') : null,
      artist: str(g(meta, 'Artist')), artistUni: str(g(meta, 'ArtistUnicode')),
      title: str(g(meta, 'Title')), titleUni: str(g(meta, 'TitleUnicode')),
      version: str(g(bm, 'DifficultyName')),
      creator: str(g(g(meta, 'Author'), 'Username') || g(meta, 'Creator')),
      source: str(g(meta, 'Source')),
      ar: g(diff, 'ApproachRate') ?? null,
      od: g(diff, 'OverallDifficulty') ?? null,
      cs: g(diff, 'CircleSize') ?? null,
      hp: g(diff, 'DrainRate') ?? null,
      stars: g(bm, 'StarRating') ?? null,
      lengthMs: g(bm, 'Length') ?? null,
      bpm: g(bm, 'BPM') ?? null,
    });
  }
  log(`谱面索引 ${mapIdx.size} 张`);

  // ---- 第一遍：统计成绩归属用户，识别本人 ----
  const userCounts = new Map();
  for (const sc of realm.objects('Score')) {
    const u = sc.User;
    if (!u) continue;
    const key = `${str(g(u, 'Username'))}|${g(u, 'OnlineID') ?? 0}`;
    userCounts.set(key, (userCounts.get(key) || 0) + 1);
  }
  let selfUser = null, best = 0;
  for (const [key, n] of userCounts) {
    if (n > best) {
      best = n;
      const [name, idRaw] = key.split('|');
      selfUser = { name, id: Number(idRaw) > 0 ? Number(idRaw) : null };
    }
  }
  if (selfUser) log(`识别本人账号：${selfUser.name}（id ${selfUser.id ?? '?'}）`);
  const allowed = new Set([selfUser?.name, ...keepNames].filter(Boolean));

  // ---- 第二遍：导入（跳过明确的他人成绩；回放导入的 id=1 成绩保留） ----
  let ok = 0, skip = 0, legacy = 0, noMap = 0, noDate = 0, foreign = 0;
  const foreignUsers = new Set();
  const foreignDedups = [];
  // 已存在的旧行：回填 player、mods_settings（含 speed_change 倍速）、mods_rate
  const updExisting = db.prepare(`UPDATE plays SET
      player = COALESCE(player, ?),
      mods_settings = CASE WHEN ? IS NOT NULL THEN ? ELSE mods_settings END,
      mods_rate = CASE WHEN ? IS NOT NULL THEN ? ELSE mods_rate END
    WHERE dedup = ?`);

  for (const sc of realm.objects('Score')) {
    if (g(sc, 'DeletePending') || g(sc, 'BackgroundReprocessingFailed')) { skip++; continue; }
    const ruleset = sc.Ruleset || {};
    if (g(ruleset, 'ShortName') && String(ruleset.ShortName).toLowerCase() !== 'osu') { skip++; continue; }

    const u = sc.User;
    const uname = str(g(u, 'Username'));
    const uid = g(u, 'OnlineID') ?? 0;
    // 他人成绩：有真实用户 id（>1）且名字不在允许名单 → 跳过，并记下去重键用于清理旧数据
    if (u && uid > 1 && uname && !allowed.has(uname)) {
      foreign++;
      foreignUsers.add(uname);
      const oid = g(sc, 'OnlineID') ?? 0;
      const lid = g(sc, 'LegacyOnlineID') ?? 0;
      foreignDedups.push(oid > 0 ? `s:${oid}` : lid > 0 ? `s:l${lid}` : `realm:${str(sc.ID)}`);
      continue;
    }

    const dateMs = toMs(sc.Date);
    if (dateMs == null) { noDate++; skip++; continue; }

    const info = mapIdx.get(str(g(sc.BeatmapInfo, 'ID') ?? '')) || {};
    if (!info.md5 && !sc.BeatmapHash) noMap++;
    // lazer 把命中统计存成 JSON 字符串（great/ok/meh/miss/perfect/good…）
    let stat = {};
    const statRaw = sc.Statistics;
    if (typeof statRaw === 'string') { try { stat = JSON.parse(statRaw); } catch {} }
    else if (statRaw && typeof statRaw === 'object') {
      const byIdx = { miss: 1, meh: 2, ok: 3, good: 4, great: 5, perfect: 6 };
      for (const [k, i] of Object.entries(byIdx)) if (statRaw[i] != null) stat[k] = statRaw[i];
    }
    const modsRaw = typeof sc.Mods === 'string' ? sc.Mods : JSON.stringify(sc.Mods || []);
    const minfo = parseModsInfo(modsRaw);

    let rank = str(sc.Rank || '');
    if (RANK_NUM[rank] !== undefined) rank = RANK_NUM[rank];

    const onlineId = g(sc, 'OnlineID') ?? 0;
    const legacyId = g(sc, 'LegacyOnlineID') ?? 0;
    const acc = g(sc, 'Accuracy');
    const pp = g(sc, 'PP');

    const rec = {
      playedAt: dateMs,
      dedup: onlineId > 0 ? `s:${onlineId}` : (legacyId > 0 ? `s:l${legacyId}` : `realm:${str(sc.ID)}`),
      scoreId: onlineId > 0 ? onlineId : null,
      player: uname || null,
      md5: info.md5 || str(sc.BeatmapHash || ''),
      fileHash: info.fileHash || '',
      setId: info.setId ?? null,
      mapId: info.mapId ?? null,
      artist: info.artist || null, artistUni: info.artistUni || null,
      title: info.title || null, titleUni: info.titleUni || null,
      version: info.version || null, creator: info.creator || null, source: info.source || null,
      mods: minfo.mods,
      modsRate: minfo.speedChange, // DT/HT 自定义倍速；默认倍速由 fillPp 按标准值补
      modsSettings: minfo.hasSettings ? modsRaw : null,
      ar: r1(info.ar), od: r1(info.od), cs: r1(info.cs), hp: r1(info.hp),
      stars: r3(info.stars), lengthMs: info.lengthMs ?? null,
      bpm: r1(info.bpm),
      acc: r2(acc != null ? acc * 100 : null),
      pp: pp != null && pp > 0 ? pp : null,
      grade: rank || null,
      maxCombo: g(sc, 'MaxCombo') ?? null,
      score: g(sc, 'TotalScore') ?? null,
      n300: stat.great ?? null,
      n100: stat.ok ?? null,
      n50: stat.meh ?? null,
      nmiss: stat.miss ?? null,
      geki: stat.perfect ?? null,
      katu: stat.good ?? null,
      ruleset: 'osu',
      src: g(sc, 'IsLegacyScore') ? 'realm-legacy' : 'realm',
      raw: JSON.stringify({ legacy: !!g(sc, 'IsLegacyScore'), legacyId, rankRaw: g(sc, 'Rank') }),
    };
    if (g(sc, 'IsLegacyScore')) legacy++;

    const res = insertPlay(db, rec);
    if (res.ok) ok++;
    else {
      skip++;
      updExisting.run(rec.player, rec.modsSettings, rec.modsSettings, rec.modsRate, rec.modsRate, rec.dedup);
    }
  }

  // ---- 清理库里已有的非本人成绩（旧版本导入留下的） ----
  let purged = 0;
  for (let i = 0; i < foreignDedups.length; i += 500) {
    const chunk = foreignDedups.slice(i, i + 500);
    purged += db.prepare(`DELETE FROM plays WHERE dedup IN (${chunk.map(() => '?').join(',')})`).run(...chunk).changes;
  }

  const foreignTxt = [...foreignUsers].join(', ') || '无';
  log(`完成：新增 ${ok}，跳过 ${skip}（legacy ${legacy}，缺图 ${noMap}，缺日期 ${noDate}）；跳过他人成绩 ${foreign}（${foreignTxt}），清理旧数据 ${purged} 条`);
  return { ok, skip, legacy, noMap, noDate, selfUser, foreign: { count: foreign, purged, users: [...foreignUsers] } };
}
