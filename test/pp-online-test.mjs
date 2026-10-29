// 在线 pp 拉取测试 v2：模拟 /beatmaps/{id}/scores/users/{uid}/all + 匹配验证
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { pullPpOnline } from '../lib/pp-online.mjs';

// 场景：
//  map 111：id 匹配 + 时间对 → 用 id 值；id 匹配但时间不对（id 复用）→ 指纹匹配；
//           一条已删除（无 id 无指纹）→ noMatch
//  map 222：beatmap 已删 → 404 → fail
const apiData = {
  111: {
    scores: [
      { id: 1001, legacy_score_id: 900001, created_at: '2026-08-01T10:00:00Z', pp: 123.45, accuracy: 0.98, max_combo: 500, mods: ['HD'] },
      // id 复用场景：我们的 score_id=1002，但 API 里 1002 是一条 2019 年的旧成绩（日期不符）
      { id: 1002, legacy_score_id: null, created_at: '2019-01-01T00:00:00Z', pp: 9.99, accuracy: 0.80, max_combo: 100, mods: ['NM'] },
      // 我们真实成绩的指纹（无 id 可对上）
      { id: 5555, legacy_score_id: null, created_at: '2026-09-20T18:30:00Z', pp: 234.56, accuracy: 0.97, max_combo: 700, mods: ['DT'] },
    ],
  },
};

const apiServer = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/oauth/token' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const p = new URLSearchParams(body);
      if (p.get('client_id') !== 'cid' || p.get('client_secret') !== 'csec') return send(401, { error: 'invalid_client' });
      send(200, { access_token: 'tok123', expires_in: 86400 });
    });
    return;
  }
  const m = req.url.match(/^\/api\/v2\/beatmaps\/(\d+)\/scores\/users\/(\d+)\/all/);
  if (m) {
    const map = Number(m[1]);
    if (!(map in apiData)) return send(404, { error: null });
    return send(200, apiData[map]);
  }
  send(404, {});
});
await new Promise(r => apiServer.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${apiServer.address().port}`;

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE plays (id INTEGER PRIMARY KEY, score_id INTEGER, map_id INTEGER, played_at INTEGER,
  mods TEXT, max_combo INTEGER, acc REAL, pp REAL, pp_source TEXT, src TEXT)`);
const ins = db.prepare('INSERT INTO plays (id, score_id, map_id, played_at, mods, max_combo, acc, pp, pp_source, src) VALUES (?,?,?,?,?,?,?,?,?,?)');
// 1: id 命中且时间对 → pp=123.45
ins.run(1, 1001, 111, Date.parse('2026-08-01T10:00:00Z'), 'HD', 500, 98.0, null, null, 'realm');
// 2: id 命中但时间差 7 年（id 复用）→ 指纹匹配到 5555 → pp=234.56
ins.run(2, 1002, 111, Date.parse('2026-09-20T18:30:00Z'), 'DT', 700, 97.0, null, null, 'realm');
// 3: 已删除，无任何匹配 → noMatch
ins.run(3, 1003, 111, Date.parse('2026-07-07T07:07:00Z'), 'NM', 300, 90.0, null, null, 'realm');
// 4: map 222 → 404 → fail
ins.run(4, 2001, 222, Date.parse('2026-08-01T10:00:00Z'), 'NM', 100, 90.0, null, null, 'realm');

const res = await pullPpOnline(db, { clientId: 'cid', clientSecret: 'csec', userId: 42, base });
console.log('结果:', JSON.stringify(res));
const rows = db.prepare('SELECT id, pp, pp_source FROM plays ORDER BY id').all();
for (const r of rows) console.log('row', r.id, 'pp=', r.pp, 'source=', r.pp_source);

const ok = res.ok === 2 && res.notFound === 1 && res.fail === 1 &&
  rows[0].pp === 123.45 && rows[0].pp_source === 'online' &&
  rows[1].pp === 234.56 && rows[1].pp_source === 'online' &&
  rows[2].pp === null && rows[3].pp === null;
console.log(ok ? 'PASS' : 'FAIL');
apiServer.close();
process.exit(ok ? 0 : 1);
