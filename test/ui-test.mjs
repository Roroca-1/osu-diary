// A complete isolated UI smoke test using synthetic scores, never a personal diary.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { seed } from './fixtures.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-diary-ui-'));
process.env.OSU_DIARY_CONFIG = path.join(tmp, 'config.json');
process.env.OSU_DIARY_DATA = path.join(tmp, 'data');
process.env.TOSU_WS = '';
const { createServer } = await import('../server.mjs');
const app = await createServer({ port: 0 });
seed(app.db);
await app.start();
const base = `http://127.0.0.1:${app.server.address().port}`;
const window = new Window({ url: base + '/#cal' });
window.fetch = (url, opts) => fetch(new URL(String(url), base), opts);
window.confirm = () => false;
window.open = () => {};
const root = path.resolve(import.meta.dirname, '..');
const pause = () => new Promise(r => setTimeout(r, 250));
try {
  window.document.write(fs.readFileSync(path.join(root, 'web/index.html'), 'utf8'));
  window.document.close();
  window.eval(fs.readFileSync(path.join(root, 'web/app.js'), 'utf8'));
  await pause();
  const doc = window.document;
  assert.ok(doc.querySelectorAll('.cal-cell').length >= 28);
  const day = doc.querySelector('.cal-cell[data-day]'); assert.ok(day);
  day.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await pause();
  assert.equal(doc.querySelector('#drawer').hidden, false);
  assert.ok(doc.querySelectorAll('#drawer .play-row').length);
  for (const view of ['stats', 'plays']) {
    window.location.hash = '#' + view; window.dispatchEvent(new window.Event('hashchange')); await pause();
    if (view === 'stats') for (const id of ['chartPp', 'chartStream', 'chartAr', 'chartBpm']) assert.ok(doc.querySelector(`#${id} svg`), id);
    else assert.equal(doc.querySelectorAll('#playsTable tbody tr').length, 12);
  }
  const th = doc.querySelector('#playsTable th[data-sort="acc"]');
  th.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await pause();
  assert.equal(th.querySelector('.sdir').textContent, '▼');
  th.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await pause();
  assert.equal(th.querySelector('.sdir').textContent, '▲');
  const link = doc.querySelector('#playsTable tbody tr a[href^="#map?"]'); assert.ok(link);
  window.location.hash = link.getAttribute('href'); window.dispatchEvent(new window.Event('hashchange')); await pause();
  assert.match(doc.querySelector('#mapBody').innerHTML, /map-title/);
  console.log('PASS: synthetic calendar, drawer, charts, list sorting and beatmap page');
} finally {
  await window.happyDOM.close(); await new Promise(r => app.server.close(r)); app.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
