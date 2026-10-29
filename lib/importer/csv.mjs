// 导入旧版 osu-reading-log.csv（date,ar,bpm,stars,map,mods,acc,miss,notes）
// 注意：旧 CSV 里被错误记录的日期无法自动修正，建议优先用 realm 导入。
import fs from 'node:fs';
import { insertPlay } from '../db.mjs';

function parseCsv(text) {
  const rows = [];
  let cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { rows.push(cur); cur = ''; }
    else if (ch === '\n') { rows.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur || text.endsWith(',')) rows.push(cur);
  return rows;
}

const num = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

export function importCsv(db, file, { log = () => {} } = {}) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const cells = parseCsv(text);
  const header = cells.slice(0, 9).map(c => c.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  let ok = 0, skip = 0, line = 0;
  for (let i = 9; i < cells.length; i += 9) {
    line++;
    const row = cells.slice(i, i + 9);
    if (row.every(c => c === '')) continue;
    const date = (row[idx.date] || '').trim();
    const mapName = (row[idx.map] || '').trim();
    if (!date || !mapName) { skip++; continue; }

    const m = mapName.match(/^(.*?)\s+-\s+(.*?)(?:\s+\[(.*?)\])?$/);
    const artist = m ? m[1] : null;
    const title = m ? m[2] : null;
    const version = m && m[3] ? m[3] : null;

    const [y, mo, d] = date.split('-').map(Number);
    const playedAt = (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d))
      ? new Date(y, mo - 1, d, 12, 0, 0).getTime() : Date.now();

    const rec = {
      playedAt,
      dedup: `csv:${line}`,
      artist, title, version,
      mods: (row[idx.mods] || '').trim() || 'NM',
      ar: num(row[idx.ar]), bpm: num(row[idx.bpm]),
      stars: num(row[idx.stars]), acc: num(row[idx.acc]),
      nmiss: num(row[idx.miss]),
      src: 'csv',
      raw: JSON.stringify({ notes: (row[idx.notes] || '').trim() }),
    };
    const res = insertPlay(db, rec);
    if (res.ok) ok++; else skip++;
  }
  log(`CSV 导入完成：新增 ${ok} 条，跳过 ${skip} 条`);
  return { ok, skip };
}
