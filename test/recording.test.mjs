import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-diary-recording-'));
process.env.OSU_DIARY_CONFIG = path.join(tmp, 'config.json');
process.env.OSU_DIARY_DATA = path.join(tmp, 'data');
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (url, ...rest) => String(url).startsWith('https://assets.ppy.sh/') ? Promise.resolve(new Response('', { status: 404 })) : fetchOriginal(url, ...rest);

test('mock tosu records real dates, rejects foreign replays and deduplicates frames', async () => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const mock = spawn(process.execPath, [path.join(import.meta.dirname, 'mock-tosu2.mjs')], { env: { ...process.env, MOCK_PORT: String(port) } });
  await once(mock.stdout, 'data');
  const { createServer } = await import('../server.mjs');
  const app = await createServer({ port: 0, tosuWs: `ws://127.0.0.1:${port}/websocket/v2` });
  await app.start();
  try {
    await new Promise(r => setTimeout(r, 5300));
    const rows = app.db.prepare('SELECT * FROM plays ORDER BY played_at').all();
    assert.equal(rows.length, 5);
    assert.ok(rows.every(r => r.player === 'ExamplePlayer'));
    const old = rows.find(r => r.score_id === 88887777);
    assert.equal(old.played_at, Date.parse('2026-09-05T19:22:11.000Z'));
    assert.equal(old.pp, 231.4);
    assert.equal(rows.find(r => r.score === 3000000).mods_rate, 1.3);
  } finally {
    app.tosuClient.stop(); await new Promise(r => app.server.close(r)); app.db.close();
    mock.kill(); await once(mock, 'exit');
    fs.rmSync(tmp, { recursive: true, force: true }); globalThis.fetch = fetchOriginal;
  }
});
