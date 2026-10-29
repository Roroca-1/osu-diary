import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osu diary lifecycle '));
const env = { ...process.env, HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, 'config'), XDG_STATE_HOME: path.join(tmp, 'state'),
  OSU_DIARY_CONFIG: path.join(tmp, 'config/diary.json'), OSU_DIARY_DATA: path.join(tmp, 'data'), OSU_DIARY_NO_SYSTEMD: '1', TOSU_WS: '' };
const portServer = net.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
env.OSU_DIARY_PORT = String(portServer.address().port); await new Promise(r => portServer.close(r));
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/osu-diary.mjs'), ...args], { env, encoding: 'utf8', timeout: 20000 });
process.on('exit', () => { run('stop'); fs.rmSync(tmp, { recursive: true, force: true }); });

test('detached start/status/restart/stop and export work with isolated data', () => {
  for (const cmd of ['start', 'status', 'restart']) { const r = run(cmd); assert.equal(r.status, 0, r.stdout + r.stderr); }
  assert.match(run('status').stdout, /Running/);
  const exportPath = path.join(tmp, 'export.csv');
  assert.equal(run('export', exportPath).status, 0);
  assert.match(fs.readFileSync(exportPath, 'utf8'), /^played_at,/);
  const r = run('stop'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(run('status').stdout, /not running/);
});
test('stale PID files do not stop another process', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']); await once(child, 'spawn');
  try {
    const state = path.join(env.XDG_STATE_HOME, 'osu-diary'); fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'diary.json'), JSON.stringify({ pid: child.pid, start: 'invalid', executable: 'other' }));
    assert.equal(run('stop').status, 0);
    process.kill(child.pid, 0);
  } finally { child.kill(); await once(child, 'exit'); }
});
test('an occupied port fails without killing the listener', async () => {
  const occupied = spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>s.end('unrelated')).listen(${env.OSU_DIARY_PORT},'127.0.0.1',()=>console.log('ready'))`]);
  await once(occupied.stdout, 'data');
  try {
    const r = run('start'); assert.notEqual(r.status, 0); assert.match(r.stderr, /failed to start/);
    process.kill(occupied.pid, 0);
  } finally { occupied.kill(); await once(occupied, 'exit'); }
});
test('unknown commands do not create a database', () => { assert.notEqual(run('not-a-command').status, 0); });
