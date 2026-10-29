// 历史成绩 pp 回填：用 rosu-pp（Rust 原生）从本地谱面文件计算
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Beatmap, Calculator } from 'rosu-pp';

// osu! legacy mods 位掩码（与 rosu-pp 一致）
const MOD_BITS = { NF: 1, EZ: 2, TD: 4, HD: 8, HR: 16, SD: 32, DT: 64, RX: 128, HT: 256,
                   NC: 512, FL: 1024, SO: 4096, AP: 8192, PF: 16384, V2: 536870912, SV2: 536870912 };
// 对 pp 影响可忽略或单独处理的 lazer 专属 mods：
// CL=Classic（影响极小，忽略）、TD=TouchDevice、DA=DifficultyAdjust（参数走 mods_settings 单独覆盖）
const IGNORABLE = new Set(['CL', 'TD', 'DA', 'NM']);

function modsToBits(modsStr) {
  const out = { bits: 0, unsupported: [] };
  for (const m of String(modsStr || '').split(',')) {
    const t = m.trim();
    if (!t) continue;
    if (MOD_BITS[t] !== undefined) out.bits |= MOD_BITS[t];
    else if (!IGNORABLE.has(t)) out.unsupported.push(t); // DA / MR / RD / TP 等
  }
  return out;
}

/** 自动探测 lazer 谱面文件目录 */
export function detectLazerFiles() {
  let base = null;
  try {
    const ini = fs.readFileSync(path.join(os.homedir(), '.local/share/osu/storage.ini'), 'utf8');
    const m = ini.match(/^\s*FullPath\s*=\s*(.+)$/m);
    if (m) base = m[1].trim();
  } catch {}
  base = base || path.join(os.homedir(), '.local/share/osu');
  return path.join(base, 'files');
}

/** 谱面文件路径：files/{h[0]}/{h[0:2]}/{h}（h = Beatmap.Hash，SHA256） */
export function beatmapFilePath(filesDir, h) {
  if (!h || h.length < 3) return null;
  return path.join(filesDir, h[0], h.slice(0, 2), h);
}

export function fillPp(db, { filesDir, withPp = true, log = () => {}, onProgress = () => {}, batch = 200 } = {}) {
  // 清理历史遗留的无效小值（失败局的 pp≈0）
  db.prepare("UPDATE plays SET pp=NULL WHERE pp IS NOT NULL AND pp < 0.5 AND src LIKE 'realm%'").run();
  // 只处理 realm 回填的历史成绩：补 pp（可选），并把 AR/OD/星级/BPM 换算成 mods 后等效值
  const rows = db.prepare(`SELECT id, md5, file_hash, mods, mods_settings, bpm, ar, acc, max_combo, n300, n100, n50, nmiss, src
    FROM plays WHERE md5 IS NOT NULL AND src LIKE 'realm%'`).all();
  const contentCache = new Map();
  const upd = withPp ? db.prepare(`UPDATE plays SET
      pp = CASE WHEN pp IS NULL THEN ? ELSE pp END,
      pp_source = CASE WHEN pp IS NULL THEN 'rosu' ELSE pp_source END,
      ar = ?, ar_orig = COALESCE(ar_orig, ar), od = ?, stars = ?, bpm_min = COALESCE(bpm_min, bpm),
      bpm = ROUND(COALESCE(bpm_min, bpm) * ?, 1), mods_rate = ?
    WHERE id = ?`)
    : db.prepare(`UPDATE plays SET
      ar = ?, ar_orig = COALESCE(ar_orig, ar), od = ?, stars = ?, bpm_min = COALESCE(bpm_min, bpm),
      bpm = ROUND(COALESCE(bpm_min, bpm) * ?, 1), mods_rate = ?
    WHERE id = ?`);
  let ppGot = 0, conv = 0, noFile = 0, skip = 0, err = 0;
  const t0 = Date.now();
  const st = () => ({ ppGot, conv, noFile, skip, err });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const { bits, unsupported } = modsToBits(r.mods);
    if (unsupported.length) { skip++; continue; }

    // DA（Difficulty Adjust）设置：mods JSON 里带 approach_rate 等覆盖值
    let da = {};
    try { da = JSON.parse(r.mods_settings || '{}'); } catch {}
    const daMod = Array.isArray(da) ? da.find(m => m?.acronym === 'DA')?.settings : (da.settings || da);
    const overrides = {};
    if (daMod && typeof daMod === 'object') {
      if (typeof daMod.approach_rate === 'number') overrides.ar = daMod.approach_rate;
      if (typeof daMod.overall_difficulty === 'number') overrides.od = daMod.overall_difficulty;
      if (typeof daMod.circle_size === 'number') overrides.cs = daMod.circle_size;
      if (typeof daMod.health_drain === 'number') overrides.hp = daMod.health_drain;
      if (typeof daMod.rate === 'number' && daMod.rate > 0) overrides.rate = daMod.rate;
    }
    // DT/NC/HT 自定义倍速（lazer 序列化为 settings.speed_change）
    let speedChange = null;
    if (Array.isArray(da)) {
      for (const m of da) {
        if (['DT', 'NC', 'HT'].includes(m?.acronym) && typeof m?.settings?.speed_change === 'number' && m.settings.speed_change > 0) {
          speedChange = m.settings.speed_change;
        }
      }
    }
    const implied = (bits & (64 | 512)) ? 1.5 : (bits & 256) ? 0.75 : 1;
    const rate = overrides.rate || speedChange || implied;

    const h = r.file_hash || null;
    const file = beatmapFilePath(filesDir, h);
    let content = contentCache.get(h);
    if (content === undefined) {
      content = null;
      if (file && fs.existsSync(file)) {
        try { content = fs.readFileSync(file).toString('utf8'); contentCache.set(h, content); }
        catch { content = null; }
      }
    }
    if (!content) { noFile++; continue; }

    try {
      const { rate: _r, ...attrOverrides } = overrides;
      const map = new Beatmap({ content, ...attrOverrides });
      const score = {
        mode: 0, mods: bits,
        acc: r.acc ?? 0,
        n300: r.n300 ?? undefined, n100: r.n100 ?? undefined, n50: r.n50 ?? undefined,
        nMisses: r.nmiss ?? undefined,
        combo: r.max_combo ?? 0,
      };
      if (Math.abs(rate - implied) > 0.001) score.clockRate = rate; // 自定义倍速：覆盖 mods 隐含的标准倍速
      const calc = new Calculator(score);
      const diff = calc.difficulty(map);   // mods 后的等效难度
      let pp = null;
      if (withPp) {
        const perf = calc.performance(map);
        // 失败局 rosu 会给出 ≈0 的 pp，低于 0.5 一律视为没有
        pp = (perf && typeof perf.pp === 'number' && perf.pp > 0.5) ? Math.round(perf.pp * 100) / 100 : null;
      }
      const arR = Math.round(diff.ar * 10) / 10;
      const odR = Math.round(diff.od * 10) / 10;
      const stR = Math.round(diff.stars * 1000) / 1000;
      if (withPp) {
        if (pp != null) ppGot++; else err++;
        upd.run(pp, arR, odR, stR, rate, rate, r.id);
      } else {
        upd.run(arR, odR, stR, rate, rate, r.id);
      }
      conv++;
    } catch (e) { err++; }

    if ((i + 1) % batch === 0) {
      log(`回填进度 ${i + 1}/${rows.length}（pp ${ppGot}，换算 ${conv}，跳过 ${skip + noFile + err}）`);
      onProgress(i + 1, rows.length, st());
    }
  }
  onProgress(rows.length, rows.length, st());
  log(`回填完成：${ppGot} 条获得 pp；${conv} 条完成 mods 换算；无谱面文件 ${noFile}；lazer 专属 mods 跳过 ${skip}；出错 ${err}；耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { ok: ppGot, conv, noFile, daSkip: skip, err, total: rows.length };
}
