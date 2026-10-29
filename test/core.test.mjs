import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, insertPlay, totalCount } from '../lib/db.mjs';
import { readConfig, saveConfig, configFile } from '../lib/config.mjs';
import { parseTosuDate } from '../lib/tosu.mjs';
import { importCsv } from '../lib/importer/csv.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-diary-tests-'));
process.env.OSU_DIARY_CONFIG = path.join(tmp, 'config.json');
process.env.OSU_DIARY_DATA = path.join(tmp, 'scores');
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

test('configuration honors overrides without persisting them; credentials are private', () => {
  saveConfig({ port: 24051, users: 'ExamplePlayer' });
  process.env.OSU_DIARY_PORT = '25252';
  assert.equal(readConfig().port, 25252);
  assert.equal(readConfig().dataDir, process.env.OSU_DIARY_DATA);
  assert.equal(JSON.parse(fs.readFileSync(configFile())).port, 24051);
  assert.equal(fs.statSync(configFile()).mode & 0o777, 0o600);
  delete process.env.OSU_DIARY_PORT;
});
test('invalid configuration is reported instead of silently resetting it', () => {
  fs.writeFileSync(configFile(), '{invalid');
  assert.throws(readConfig, /Cannot read/);
  fs.rmSync(configFile());
});
test('real score timestamps parse correctly', () => {
  const iso = '2026-09-05T19:22:11.000Z', ms = Date.parse(iso);
  assert.equal(parseTosuDate(iso), ms);
  assert.equal(parseTosuDate(String(ms)), ms);
  assert.equal(parseTosuDate(String(ms / 1000)), ms);
  assert.equal(parseTosuDate(null), null);
});
test('score deduplication and legacy CSV import preserve score dates', () => {
  const db = openDb(path.join(tmp, 'test.db'));
  const score = { scoreId: 42, playedAt: Date.parse('2026-02-01T12:00:00Z'), md5: 'test', score: 1000 };
  assert.equal(insertPlay(db, score).ok, true);
  assert.equal(insertPlay(db, score).skipped, true);
  assert.equal(totalCount(db), 1);
  const file = path.join(tmp, 'legacy.csv');
  fs.writeFileSync(file, 'date,ar,bpm,stars,map,mods,acc,miss,notes\n2026-02-02,9,180,5,Example Artist - Example Song [Insane],HD,98,1,synthetic\n');
  assert.equal(importCsv(db, file).ok, 1);
  assert.equal(importCsv(db, file).ok, 0);
  assert.equal(totalCount(db), 2);
  assert.equal(new Date(db.prepare("SELECT played_at FROM plays WHERE src='csv'").get().played_at).getFullYear(), 2026);
  db.close();
});
