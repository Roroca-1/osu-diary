import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
console.log('DA 成绩 pp 样例:');
for (const r of db.prepare("SELECT title, version, ar, pp, acc FROM plays WHERE mods LIKE '%DA%' AND pp IS NOT NULL LIMIT 6").all())
  console.log(' ', r.pp + 'pp', r.title, '[' + r.version + ']', 'AR', r.ar, r.acc + '%');
console.log('CL 成绩 pp 样例:');
for (const r of db.prepare("SELECT title, version, pp, mods FROM plays WHERE mods LIKE '%CL%' AND pp IS NOT NULL ORDER BY pp DESC LIMIT 4").all())
  console.log(' ', r.pp + 'pp', r.title, '[' + r.version + ']', r.mods);
console.log('mods 分布（全部）:');
for (const r of db.prepare('SELECT mods, COUNT(*) n FROM plays GROUP BY mods ORDER BY n DESC LIMIT 10').all())
  console.log(' ', r.mods || '(空)', '→', r.n);
