// 在线拉取 pp：osu! API v2
// 当前 API 已没有按 score id 查询的端点，改走：
//   GET /api/v2/beatmaps/{beatmap}/scores/users/{user}/all?ruleset=osu
// 拉回该用户在某张图上的全部成绩，再按 id / 指纹核对后更新 pp。
const DEFAULT_BASE = 'https://osu.ppy.sh';

async function getToken(base, clientId, clientSecret) {
  const r = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: 'client_credentials', scope: 'public',
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`获取 token 失败（HTTP ${r.status}）：${t.slice(0, 120)}`);
  }
  const j = await r.json();
  return j.access_token;
}

/** 精确匹配：id 命中 + 时间核对（±2 小时，防 id 复用） */
function verify(cand, row) {
  if (!cand) return false;
  const t = Date.parse(cand.created_at);
  return Number.isFinite(t) && Math.abs(t - row.played_at) <= 2 * 3600 * 1000;
}

const IGNORABLE_MODS = new Set(['CL', 'TD', 'DA']);

/** 指纹匹配：同图 + 时间 ±30 分钟 + combo + acc + mods（忽略 lazer 专属） */
function fingerprintMatch(scores, row) {
  const want = String(row.mods || '').split(',').map(s => s.trim()).filter(m => m && !IGNORABLE_MODS.has(m)).sort().join('+');
  for (const s of scores) {
    const t = Date.parse(s.created_at);
    if (!Number.isFinite(t)) continue;
    if (Math.abs(t - row.played_at) > 30 * 60 * 1000) continue;
    if (row.max_combo != null && s.max_combo !== row.max_combo) continue;
    if (row.acc != null && Math.abs(s.accuracy * 100 - row.acc) > 0.5) continue;
    const got = (s.mods || []).filter(m => !IGNORABLE_MODS.has(m)).sort().join('+');
    if (want !== got) continue;
    return s;
  }
  return null;
}

export async function pullPpOnline(db, { clientId, clientSecret, userId, base = DEFAULT_BASE,
                                         force = false, log = () => {}, onProgress = () => {} } = {}) {
  if (!clientId || !clientSecret) throw new Error('缺少 osu! API 凭证（client_id / client_secret）');
  if (!userId) throw new Error('缺少 osu 用户 ID（重新导入一次 realm 会自动识别，或在设置里手动填）');
  const token = await getToken(base, clientId, clientSecret);

  const rows = db.prepare(`
    SELECT id, score_id, map_id, mods, played_at, max_combo, acc, src
    FROM plays
    WHERE score_id IS NOT NULL AND score_id > 0 AND map_id IS NOT NULL
      AND (${force ? '1=1' : "pp_source IS NULL OR pp_source != 'online'"})
    ORDER BY played_at DESC`).all();
  const upd = db.prepare("UPDATE plays SET pp=?, pp_source='online' WHERE id=?");

  // 按图分组：一张图一次请求
  const byMap = new Map();
  for (const r of rows) {
    if (!byMap.has(r.map_id)) byMap.set(r.map_id, []);
    byMap.get(r.map_id).push(r);
  }
  const maps = [...byMap.keys()];

  let ok = 0, noMatch = 0, fail = 0;
  const t0 = Date.now();
  const st = () => ({ ok, noMatch, fail });

  for (let i = 0; i < maps.length; i++) {
    const mapId = maps[i];
    const group = byMap.get(mapId);
    try {
      const r = await fetch(`${base}/api/v2/beatmaps/${mapId}/scores/users/${userId}/all?ruleset=osu`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) { fail++; }
      else {
        const j = await r.json();
        const scores = j.scores || [];
        const byId = new Map(), byLegacy = new Map();
        for (const s of scores) {
          if (s.id) byId.set(s.id, s);
          if (s.legacy_score_id) byLegacy.set(s.legacy_score_id, s);
        }
        for (const row of group) {
          let cand = byId.get(row.score_id) || (String(row.src).includes('legacy') ? byLegacy.get(row.score_id) : null);
          if (!verify(cand, row)) cand = fingerprintMatch(scores, row);   // id 对不上/时间不符 → 指纹
          if (cand && typeof cand.pp === 'number' && cand.pp > 0) {
            upd.run(Math.round(cand.pp * 100) / 100, row.id);
            ok++;
          } else noMatch++;
        }
      }
    } catch (e) { fail++; }
    // 限流：约 1 次/秒
    await new Promise(res => setTimeout(res, 1100));
    if ((i + 1) % 5 === 0 || i === maps.length - 1) {
      log(`在线 pp 进度 ${i + 1}/${maps.length} 张图（更新 ${ok}，无匹配 ${noMatch}，失败 ${fail}）`);
      onProgress(i + 1, maps.length, st());
    }
  }
  onProgress(maps.length, maps.length, st());
  log(`在线 pp 完成：${ok} 条更新；无匹配 ${noMatch}；请求失败 ${fail}；耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { ok, notFound: noMatch, fail, total: rows.length, maps: maps.length };
}
