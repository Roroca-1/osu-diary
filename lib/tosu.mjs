// tosu websocket/v2 客户端：解析帧、识别结算画面、用 createdAt（真实成绩时间）记录
import { EventEmitter } from 'node:events';

/** 兼容 tosu 可能的包装层 */
function unwrap(raw) {
  let d;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== 'object') return null;
  if (d.beatmap || d.state || d.resultsScreen || d.play) return d;
  for (const k of ['data', 'message', 'payload', 'result']) {
    const v = d[k];
    if (v && typeof v === 'object' && (v.beatmap || v.state || v.resultsScreen || v.play)) return v;
  }
  return d;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析 tosu 的 createdAt（resultScreen.date = lazer ScoreInfo.Date，成绩的真实时间）。
 * 支持 ISO 字符串 / .NET ticks / unix 秒 / unix 毫秒。
 */
export function parseTosuDate(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return s > 1e12 ? s : s * 1000;
  const t = String(s).trim();
  if (!t) return null;
  let m = Date.parse(t);
  if (!Number.isNaN(m)) return m;
  if (/^\d{17,19}$/.test(t)) return (Number(t) - 621355968000000000) / 10000; // .NET ticks
  if (/^\d{13}$/.test(t)) return Number(t);
  if (/^\d{10}$/.test(t)) return Number(t) * 1000;
  m = Date.parse(t.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
  if (!Number.isNaN(m)) return m;
  return null;
}

/** osu! AR → 判定窗口毫秒 */
function arToMs(ar) {
  return ar <= 5 ? 1800 - 120 * ar : 1950 - 150 * ar;
}

const SETTLE_DELAY_MS = 2500; // 结算画面出现后等 pp 计算稳定再入库

export class TosuClient extends EventEmitter {
  constructor({ wsUrl, onScore, log = () => {} }) {
    super();
    this.wsUrl = wsUrl;
    this.onScore = onScore;
    this.log = log;
    this.connected = false;
    this.state = '?';
    this.currentBeatmap = null;   // 当前帧的谱面信息
    this.live = null;             // 游玩中的快照
    this.pending = new Map();     // key → { timer, lastFrame, beatmap }
    this.seen = new Set();
    this._closed = false;
  }

  start() {
    this._closed = false;
    this._connect();
  }

  stop() {
    this._closed = true;
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    if (this._ws) { try { this._ws.close(); } catch {} }
  }

  _connect() {
    if (this._closed) return;
    let ws;
    try { ws = new WebSocket(this.wsUrl); } catch (e) { this._retrySoon(); return; }
    this._ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.emit('status', { connected: true });
      this.log('[tosu] 已连接');
    };
    ws.onmessage = (e) => {
      const d = unwrap(e.data);
      if (!d) return;
      try { this._frame(d); } catch (err) { this.log(`[tosu] 解析出错: ${err.message}`); }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      this.connected = false;
      this.emit('status', { connected: false });
      this._retrySoon();
    };
  }

  _retrySoon() {
    if (this._closed) return;
    this.log('[tosu] 断开，3 秒后重连…');
    setTimeout(() => this._connect(), 3000);
  }

  _frame(d) {
    this.state = d.state?.name || this.state;

    // 谱面快照（选图/游玩中都会更新）
    const bm = d.beatmap;
    if (bm && bm.checksum) {
      const st = bm.stats || {};
      this.currentBeatmap = {
        at: Date.now(),
        md5: bm.checksum || null,
        setId: num(bm.set),
        mapId: num(bm.id),
        artist: bm.artist || '',
        artistUni: bm.artistUnicode || '',
        title: bm.title || '',
        titleUni: bm.titleUnicode || '',
        version: bm.version || '',
        creator: bm.mapper || '',
        source: bm.source || '',
        ar: num(st.ar?.converted),
        arOrig: num(st.ar?.original),
        od: num(st.od?.converted), cs: num(st.cs?.converted), hp: num(st.hp?.converted),
        bpm: num(st.bpm?.common), bpmMin: num(st.bpm?.min), bpmMax: num(st.bpm?.max),
        stars: num(st.stars?.total),
        lengthMs: num(bm.time?.mp3Length),
      };
      if (this.state === 'play' || this.state === 'Play') this.live = this.currentBeatmap;
    }

    // 结算画面
    const rs = d.resultsScreen;
    if (!rs || typeof rs !== 'object') return;
    const acc = num(rs.accuracy);
    const score = num(rs.score);
    if (acc === null || acc <= 0) return;
    if ((score === null || score <= 0) && !String(rs.createdAt || '').trim()) return;

    const key = this._key(rs);
    if (!key) return;

    const existing = this.pending.get(key);
    if (this.seen.has(key) || existing) {
      // 同一局连发多帧：更新待定成绩里的最新帧（等 pp 稳定）
      if (existing) this._updatePending(d, rs, key);
      return;
    }

    this.seen.add(key);
    if (this.seen.size > 800) this.seen.clear();

    // 谱面信息优先用当前帧（重看老回放时当前帧才是对的）；没有则回退到游玩中的快照
    const cur = this.currentBeatmap && this.currentBeatmap.md5 ? this.currentBeatmap : null;
    const liveOk = this.live && Date.now() - this.live.at < 10 * 60 * 1000 ? this.live : null;
    const entry = { key, lastFrame: null, beatmap: cur || liveOk, timer: null };
    this.pending.set(key, entry);
    this._updatePending(d, rs, key);
    entry.timer = setTimeout(() => {
      try { this._finalize(key); } catch (e) { this.log(`[tosu] 结算处理出错: ${e.message}`); }
    }, SETTLE_DELAY_MS);
  }

  _key(rs) {
    const scoreId = num(rs.scoreId);
    if (scoreId && scoreId > 0) return 's:' + scoreId;
    const h = rs.hits || {};
    return ['p',
      rs.score ?? '', num(h['300']) ?? '', num(h['100']) ?? '', num(h['50']) ?? '', num(h['0']) ?? '',
      num(rs.accuracy)?.toFixed(2) ?? '', num(rs.maxCombo) ?? ''
    ].join('|');
  }

  _updatePending(d, rs, key) {
    const p = this.pending.get(key);
    if (!p) return;
    p.lastFrame = { d, rs };
    // 结算期间谱面信息可能仍会更新
    if (!p.beatmap && this.currentBeatmap && this.currentBeatmap.md5) p.beatmap = this.currentBeatmap;
  }

  _finalize(key) {
    const p = this.pending.get(key);
    this.pending.delete(key);
    if (!p || !p.lastFrame) return;
    const { d, rs } = p.lastFrame;

    // 关键修复：成绩时间 = createdAt（真实时间），而不是入库时间
    let playedAt = parseTosuDate(rs.createdAt);
    const dateSource = playedAt != null ? 'createdAt' : 'now-fallback';
    if (playedAt == null) playedAt = Date.now();

    const bm = p.beatmap || {};
    const hits = rs.hits || {};
    const play = d.play || {};
    const modsArr = Array.isArray(rs.mods?.array) && rs.mods.array.length ? rs.mods.array : [];
    const modsName = String(rs.mods?.name || '').trim();
    const mods = modsArr.length ? modsArr.join(',') : (modsName || 'NM');
    const grade = String(rs.rank || '');
    const perfect = /SS|XH|X/i.test(grade) && !/F/.test(grade) ? 1 : 0;
    const scoreId = num(rs.scoreId);

    // ---- 倍速识别 ----
    // tosu 的 mods.rate 对 lazer 的自定义 DT 变速不可靠，因此：
    // 带 DT/NC/HT 且无 HR/EZ/DA（这些也会改 AR）时，从 AR 换算反推实际倍速；
    // 反推值在标准倍速附近（1 位小数 AR 的舍入误差内）则吸附回标准值。
    const modList = mods.split(',').map(s => s.trim());
    const hasRateMod = modList.some(m => m === 'DT' || m === 'NC' || m === 'HT');
    const hasArMod = modList.some(m => m === 'HR' || m === 'EZ' || m === 'DA');
    const stdRate = modList.includes('DT') || modList.includes('NC') ? 1.5 : modList.includes('HT') ? 0.75 : 1;
    let modsRate = num(rs.mods?.rate) ?? null;
    if (hasRateMod && !hasArMod && bm.arOrig != null && bm.arOrig > 0 && bm.ar != null && bm.ar > 0) {
      const back = arToMs(bm.arOrig) / arToMs(bm.ar);
      if (back > 0.4 && back < 4) {
        modsRate = Math.abs(back - stdRate) <= 0.04 ? stdRate : Math.round(back * 100) / 100;
      }
    }
    if (modsRate == null) modsRate = stdRate;
    // BPM 换算为实际游玩 BPM（原值存 bpm_min 保留）
    let bpm = bm.bpm ?? null;
    if (bpm != null && Math.abs(modsRate - 1) > 0.001) bpm = Math.round(bpm * modsRate * 10) / 10;

    const rec = {
      playedAt,
      dateSource,
      player: String(rs.playerName || '').trim() || null,
      md5: bm.md5 ?? null,
      setId: bm.setId ?? null,
      mapId: bm.mapId ?? null,
      artist: bm.artist || null,
      artistUni: bm.artistUni || null,
      title: bm.title || null,
      titleUni: bm.titleUni || null,
      version: bm.version || null,
      creator: bm.creator || null,
      source: bm.source || null,
      mods,
      modsRate,
      ar: bm.ar ?? null,
      arOrig: bm.arOrig ?? null,
      od: bm.od ?? null, cs: bm.cs ?? null, hp: bm.hp ?? null,
      bpm, bpmMin: bm.bpm ?? null, bpmMax: bm.bpmMax ?? null,
      stars: bm.stars ?? null,
      lengthMs: bm.lengthMs ?? null,
      acc: num(rs.accuracy),
      pp: num(rs.pp?.current) ?? null,
      ppFc: num(rs.pp?.fc) ?? null,
      ur: num(play.unstableRate) ?? null,
      grade: grade || null,
      perfect,
      maxCombo: num(rs.maxCombo),
      score: num(rs.score),
      scoreId: scoreId && scoreId > 0 ? scoreId : null,
      ruleset: String(rs.mode?.name || 'osu'),
      n300: num(hits['300']), n100: num(hits['100']), n50: num(hits['50']),
      nmiss: num(hits['0']), geki: num(hits.geki), katu: num(hits.katu),
      sliderEnd: num(hits.sliderEndHits),
      sliderBreaks: num(play.hits?.sliderBreaks),
      src: 'tosu',
    };
    rec.raw = JSON.stringify({ rs, bm, play: { ur: rec.ur, sliderBreaks: rec.sliderBreaks } });

    this.onScore(rec, d);
  }
}
