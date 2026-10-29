import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
console.log('total:', db.prepare("SELECT COUNT(*) n FROM plays").get().n);
console.log('with pp:', db.prepare("SELECT COUNT(*) n FROM plays WHERE pp IS NOT NULL").get().n);
console.log('range:', db.prepare("SELECT datetime(MIN(played_at)/1000,'unixepoch') a, datetime(MAX(played_at)/1000,'unixepoch') b FROM plays").get());
console.log('legacy:', db.prepare("SELECT COUNT(*) n FROM plays WHERE src = 'realm-legacy'").get().n);
console.log('rows with stats:', db.prepare('SELECT COUNT(*) n FROM plays WHERE n300 IS NOT NULL AND nmiss IS NOT NULL').get().n);
console.log('distinct sets:', db.prepare('SELECT COUNT(DISTINCT set_id) n FROM plays WHERE set_id IS NOT NULL').get().n);
console.log('distinct days:', db.prepare("SELECT COUNT(DISTINCT date(played_at/1000,'unixepoch','localtime')) n FROM plays").get().n);
console.log('days with plays per week (recent 8):');
for (const r of db.prepare("SELECT date(played_at/1000,'unixepoch','localtime') d, COUNT(*) n, MAX(acc) topacc FROM plays GROUP BY d ORDER BY d DESC LIMIT 8").all()) console.log(' ', r.d, r.n + '局', 'acc', r.topacc?.toFixed(2));
const rows = db.prepare('SELECT * FROM plays ORDER BY played_at LIMIT 3').all();
for (const r of rows) console.log(JSON.stringify({
  date: new Date(r.played_at).toISOString(), artist: r.artist, title: r.title, version: r.version,
  mods: r.mods, ar: r.ar, od: r.od, bpm: r.bpm, stars: r.stars, acc: r.acc ? +r.acc.toFixed(2) : null,
  pp: r.pp, grade: r.grade, n300: r.n300, n100: r.n100, n50: r.n50, nmiss: r.nmiss,
  geki: r.geki, katu: r.katu, maxCombo: r.max_combo, score_id: r.score_id, set_id: r.set_id, src: r.src,
}));
