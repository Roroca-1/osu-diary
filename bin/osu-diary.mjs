#!/usr/bin/env node
// osu-diary CLI：serve / import realm / import csv / export / status
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../lib/config.mjs';
import { manage, isManagementCommand } from '../lib/manage.mjs';
const [cmd, ...rest] = process.argv.slice(2);
const usage = `
osu-diary — osu! 日记

用法：
  osu-diary start | stop | restart | open | status | enable | disable | log | doctor
  osu-diary serve              启动服务（tosu 监听 + Web 界面 http://127.0.0.1:24051）
  osu-diary uninstall          Remove program files; keep diary data/configuration
  osu-diary import realm       从 lazer 的 client.realm 回填全部历史成绩（真实日期+pp）
  osu-diary import pp          重算历史成绩 pp（rosu-pp）
  osu-diary import csv <file>  导入旧版 osu-reading-log.csv
  osu-diary export <file>      导出全部成绩为 CSV
  osu-diary status             查看数据库概况

环境变量：OSU_DIARY_PORT / TOSU_WS / OSU_DIARY_DATA
`;

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(usage); return; }

  if (cmd === 'uninstall') { await (await import('./uninstall.mjs')).uninstall(); return; }
  if (cmd === 'supervise') { await (await import('../lib/manage.mjs')).supervise(); return; }
  if (isManagementCommand(cmd)) { await manage(cmd, rest); return; }

  if (!['serve', 'import', 'export'].includes(cmd)) throw new Error('Unknown command. Run osu-diary help.');
  const { createServer } = await import('../server.mjs');
  const { openDb, totalCount, lastPlay } = await import('../lib/db.mjs');

  if (cmd === 'serve') {
    const app = await createServer();
    const { start, cfg } = app;
    const shutdown = () => { app.tosuClient?.stop(); app.server.close(() => { app.db.close(); process.exit(0); }); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    await start();
    console.log(`osu-diary 已启动 → http://127.0.0.1:${cfg.port}`);
    console.log(`数据目录：${cfg.dataDir}`);
  } else {
    // 一次性命令：直接开库（数据目录与服务器一致）
    const { dataDir } = readConfig();
    const db = openDb(path.join(dataDir, 'diary.db'));

    if (cmd === 'import' && rest[0] === 'realm') {
      const { importRealm } = await import('../lib/importer/realm.mjs');
      // 解析 --keep 用户名1,用户名2 参数
      const keepIdx = rest.indexOf('--keep');
      const keepNames = keepIdx >= 0 && rest[keepIdx + 1]
        ? String(rest[keepIdx + 1]).split(',').map(s => s.trim()).filter(Boolean) : [];
      const realmPath = rest[1] && !rest[1].startsWith('--') ? rest[1] : null;
      const r = await importRealm(db, { realmPath, keepNames, tmpDir: dataDir, log: m => console.log(m) });
      // 无论是否新增，都要跑一遍换算（已存在的行也要更新倍速/等效 AR/pp）
      const { fillPp, detectLazerFiles } = await import('../lib/pp.mjs');
      fillPp(db, { filesDir: detectLazerFiles(), log: m => console.log(m) });
    } else if (cmd === 'import' && rest[0] === 'pp') {
      const { fillPp, detectLazerFiles } = await import('../lib/pp.mjs');
      fillPp(db, { filesDir: detectLazerFiles(), log: m => console.log(m) });
    } else if (cmd === 'import' && rest[0] === 'csv') {
      const { importCsv } = await import('../lib/importer/csv.mjs');
      const file = rest[1];
      if (!file) { console.error('用法：osu-diary import csv <file>'); process.exit(1); }
      importCsv(db, file, { log: m => console.log(m) });
    } else if (cmd === 'export') {
      const { exportRows } = await import('../lib/db.mjs');
      const rows = exportRows(db);
      const head = 'played_at,artist,title,version,mods,ar,bpm,stars,acc,pp,grade,max_combo,miss,set_id,map_id,md5,ur\n';
      const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const out = head + rows.map(r => [new Date(r.played_at).toISOString(), r.artist, r.title, r.version, r.mods,
        r.ar, r.bpm, r.stars, r.acc, r.pp, r.grade, r.max_combo, r.nmiss, r.set_id, r.map_id, r.md5, r.ur]
        .map(esc).join(',')).join('\n');
      const dest = rest[0] || path.join(os.homedir(), 'osu-diary-export.csv');
      fs.writeFileSync(dest, out);
      console.log(`已导出 ${rows.length} 条 → ${dest}`);
    } else if (cmd === 'status') {
      const last = lastPlay(db);
      console.log(`总成绩：${totalCount(db)} 条`);
      if (last) console.log(`最近一局：${new Date(last.played_at).toISOString()}  ${last.artist} - ${last.title} [${last.version}]  pp ${last.pp ?? '-'}`);
      else console.log('还没有记录');
    } else {
      console.log(usage);
    }
    db.close();
    process.exit(0); // realm 等原生模块可能挂住事件循环
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
