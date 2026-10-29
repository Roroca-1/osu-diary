import { insertPlay } from '../lib/db.mjs';

export function seed(db) {
  const base = new Date(); base.setDate(15); base.setHours(12, 0, 0, 0);
  for (let i = 0; i < 12; i++) insertPlay(db, {
    playedAt: base.getTime() + i * 1000, scoreId: 10000 + i, md5: `synthetic-${i % 3}`,
    artist: 'Example Artist', title: `Synthetic Map ${i % 3}`, version: 'Test Difficulty', creator: 'Example Mapper',
    mods: i % 2 ? 'HD,DT' : 'NM', ar: 9.2 + (i % 3) * 0.4, bpm: 175 + i, stars: 5 + i / 10,
    acc: 90 + i / 2, pp: 100 + i, maxCombo: 100 + i, score: 100000 + i, n300: 100, n100: 2, n50: 1, nmiss: i % 3,
    player: 'ExamplePlayer', src: 'fixture', ruleset: 'osu',
  });
  return base;
}
