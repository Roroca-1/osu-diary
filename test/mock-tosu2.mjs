// 模拟 tosu /websocket/v2：完整 v2 结构，验证时间戳修复与 pp 记录
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 24151);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(str) {
  const body = Buffer.from(str, 'utf8');
  const n = body.length;
  let head;
  if (n < 126) head = Buffer.from([0x81, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, body]);
}

function mk({ state = 'Menu', bm = null, play = null, rs = null, directBg = null, self = 'ExamplePlayer' } = {}) {
  return {
    state: { number: state === 'Play' ? 2 : state === 'ResultScreen' ? 7 : 1, name: state },
    profile: { name: self },
    beatmap: bm ? {
      checksum: bm.md5, id: bm.mapId, set: bm.setId,
      artist: bm.artist, artistUnicode: bm.artistUni, title: bm.title, titleUnicode: bm.titleUni,
      mapper: bm.creator, version: bm.version, source: 'test',
      time: { mp3Length: bm.len },
      stats: {
        stars: { live: 0, total: bm.stars },
        ar: { original: bm.ar, converted: bm.arConv },
        od: { original: 8, converted: 8 }, cs: { original: 4, converted: 4 }, hp: { original: 6, converted: 6 },
        bpm: { realtime: bm.bpm, common: bm.bpm, min: bm.bpm, max: bm.bpm },
        objects: { total: 1000 },
      },
    } : { checksum: '', stats: {} },
    play: play ? {
      accuracy: play.acc, unstableRate: play.ur ?? 0,
      hits: { sliderBreaks: play.sb ?? 0 },
      mods: { number: 0, name: play.mods || '', array: (play.mods || '').split('+').filter(Boolean), rate: play.rate ?? 1 },
    } : { accuracy: 0, unstableRate: 0, hits: { sliderBreaks: 0 }, mods: { number: 0, name: '', array: [], rate: 1 } },
    resultsScreen: rs ? {
      scoreId: rs.scoreId ?? 0, playerName: rs.playerName ?? 'ExamplePlayer', mode: { number: 0, name: 'osu' },
      score: rs.score, accuracy: rs.acc, name: rs.playerName ?? 'ExamplePlayer',
      hits: { '300': rs.n300 ?? 0, geki: 0, '100': rs.n100 ?? 0, katu: 0, '50': rs.n50 ?? 0, '0': rs.miss ?? 0, sliderEndHits: 0 },
      mods: { number: 0, name: rs.mods || '', array: (rs.mods || '').split('+').filter(Boolean), rate: rs.rate ?? 1 },
      maxCombo: rs.maxCombo ?? 0, rank: rs.rank ?? 'A',
      pp: { current: rs.pp ?? 0, fc: rs.ppFc ?? 0 },
      createdAt: rs.createdAt ?? '',
    } : { scoreId: 0, score: 0, accuracy: 0, hits: { '300': 0, '100': 0, '50': 0, '0': 0 }, mods: { name: '', array: [], rate: 1 }, maxCombo: 0, rank: '', pp: { current: 0, fc: 0 }, createdAt: '' },
    directPath: directBg ? { beatmapBackground: directBg } : { beatmapBackground: '' },
  };
}

const MAP1 = { md5: 'aaa111', mapId: 111, setId: 842206, artist: 'Camellia', artistUni: 'かめりあ', title: 'crystallized', titleUni: 'crystallized', creator: 'Sotarks', version: 'Insane', ar: 9.2, arConv: 9.2, stars: 6.0, bpm: 175, len: 210000 };
const MAP2 = { md5: 'bbb222', mapId: 222, setId: 1234567, artist: 'Kobaryo', artistUni: 'Kobaryo', title: 'Last Resort', titleUni: 'Last Resort', creator: 'N/A', version: 'Insane', ar: 9, arConv: 10.3, stars: 7.4, bpm: 292.5, len: 180000 };
const EMPTY = { md5: '', mapId: 0, setId: 0, stars: 0, ar: 0, arConv: 0, bpm: 0, len: 0 };

const SCRIPT = [
  // —— 场景 1：一个月前打的历史成绩（模拟"导入的成绩"，createdAt 是过去时间）——
  [100, mk({ state: 'Menu', bm: EMPTY })],
  [300, mk({ state: 'ResultScreen', bm: MAP1,
    play: { acc: 96.1, ur: 120, sb: 2, mods: 'HD', rate: 1 },
    rs: { scoreId: 88887777, score: 9876543, acc: 96.13, mods: 'HD', rate: 1, maxCombo: 812, rank: 'S',
          pp: 231.4, ppFc: 255, n300: 900, n100: 25, n50: 2, miss: 3,
          createdAt: '2026-09-05T19:22:11.000Z' } })],
  [450, mk({ state: 'ResultScreen', bm: MAP1,
    play: { acc: 96.1, ur: 120, sb: 2, mods: 'HD', rate: 1 },
    rs: { scoreId: 88887777, score: 9876543, acc: 96.13, mods: 'HD', rate: 1, maxCombo: 812, rank: 'S',
          pp: 231.4, ppFc: 255, n300: 900, n100: 25, n50: 2, miss: 3,
          createdAt: '2026-09-05T19:22:11.000Z' } })],

  // —— 场景 2：刚刚打的一局（createdAt = 今天）——
  [800, mk({ state: 'Play', bm: MAP2, play: { acc: 88, mods: 'DT', rate: 1.5 } })],
  [1000, mk({ state: 'ResultScreen', bm: MAP2,
    play: { acc: 88.4, ur: 165, sb: 0, mods: 'DT', rate: 1.5 },
    rs: { scoreId: 0, score: 2234567, acc: 88.42, mods: 'DT', rate: 1.5, maxCombo: 480, rank: 'A',
          pp: 145.2, ppFc: 200, n300: 1100, n100: 80, n50: 10, miss: 12,
          createdAt: new Date().toISOString() } })],

  // —— 场景 3：老成绩重看（replay 观看，createdAt 两个月前），同 md5+score 重复帧 ——
  [1300, mk({ state: 'ResultScreen', bm: MAP1,
    play: { acc: 90, mods: '', rate: 1 },
    rs: { scoreId: 0, score: 555000, acc: 90.50, mods: 'NM', rate: 1, maxCombo: 300, rank: 'B',
          pp: 120, ppFc: 180, n300: 700, n100: 90, n50: 20, miss: 15,
          createdAt: '2026-08-02T11:05:00.000Z' } })],
  [1450, mk({ state: 'ResultScreen', bm: MAP1,
    play: { acc: 90, mods: '', rate: 1 },
    rs: { scoreId: 0, score: 555000, acc: 90.50, mods: 'NM', rate: 1, maxCombo: 300, rank: 'B',
          pp: 120, ppFc: 180, n300: 700, n100: 90, n50: 20, miss: 15,
          createdAt: '2026-08-02T11:05:00.000Z' } })],

  // —— 场景 4：看别人的 replay（playerName ≠ 自己）—— 必须被过滤掉 ——
  [1700, mk({ state: 'ResultScreen', bm: MAP2,
    play: { acc: 97, mods: 'HDDT', rate: 1.5 },
    rs: { scoreId: 99999999, playerName: 'some_other_player', score: 7777777, acc: 97.20,
          mods: 'HDDT', rate: 1.5, maxCombo: 900, rank: 'S',
          pp: 400, ppFc: 450, n300: 1500, n100: 30, n50: 0, miss: 2,
          createdAt: new Date().toISOString() } })],

  // —— 场景 5：自己的成绩但用了自定义倍速 DT 1.3 ——
  // —— 场景 5：自己的成绩但用了自定义倍速 DT 1.3（tosu 的 rate 字段不可靠，仍报 1.5；
  //          AR 换算后应为 9.92 → 从 AR 反推 rate=1.3）——
  [2000, mk({ state: 'ResultScreen', bm: { ...MAP2, arConv: 9.92 },
    play: { acc: 90, mods: 'DT', rate: 1.5 },
    rs: { scoreId: 0, playerName: 'ExamplePlayer', score: 3000000, acc: 90.00,
          mods: 'DT', rate: 1.5, maxCombo: 600, rank: 'A',
          pp: 180, ppFc: 220, n300: 1200, n100: 60, n50: 5, miss: 8,
          createdAt: new Date().toISOString() } })],

  // —— 场景 6：自己的默认倍速 DT（不该显示 ×1.5，验证 display 逻辑由前端做）——
  [2300, mk({ state: 'ResultScreen', bm: MAP2,
    play: { acc: 91, mods: 'DT', rate: 1.5 },
    rs: { scoreId: 0, playerName: 'ExamplePlayer', score: 3100000, acc: 91.00,
          mods: 'DT', rate: 1.5, maxCombo: 610, rank: 'A',
          pp: 190, ppFc: 230, n300: 1250, n100: 50, n50: 5, miss: 6,
          createdAt: new Date().toISOString() } })],
];

const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  SCRIPT.forEach(([delay, data]) => setTimeout(() => { try { socket.write(frame(JSON.stringify(data))); } catch {} }, delay));
  setTimeout(() => { try { socket.end(); } catch {} }, 6000);
});
server.listen(PORT, '127.0.0.1', () => console.log(`mock tosu 监听 127.0.0.1:${PORT}`));
