import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readConfig, projectDir, stateDir, configHome, configFile } from './config.mjs';

const commands = new Set(['start', 'stop', 'restart', 'open', 'status', 'enable', 'disable', 'log', 'doctor']);
export const isManagementCommand = cmd => commands.has(cmd);
const unit = 'osu-diary.service';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cliPath = path.join(projectDir, 'bin/osu-diary.mjs');
const systemctl = (...args) => spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8', timeout: 10000 });
const haveSystemd = () => process.env.OSU_DIARY_NO_SYSTEMD !== '1' && systemctl('show-environment').status === 0;
const unitFile = () => path.join(configHome(), 'systemd/user', unit);
const ownUnit = () => { try { return fs.readFileSync(unitFile(), 'utf8').includes('# Managed by osu-diary portable installer'); } catch { return false; } };
const pidFile = kind => path.join(stateDir(), `${kind}.json`);
const logFile = kind => path.join(stateDir(), `${kind}.log`);
const procStart = pid => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')[19];

// Check both process identity and start time, protecting against stale PID reuse.
function ownedProcess(kind) {
  try {
    const saved = JSON.parse(fs.readFileSync(pidFile(kind), 'utf8'));
    if (procStart(saved.pid) !== saved.start) return null;
    const args = fs.readFileSync(`/proc/${saved.pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    if (!args.includes(saved.executable)) return null;
    return saved;
  } catch { return null; }
}
async function stopProcess(kind) {
  const saved = ownedProcess(kind);
  if (saved) {
    try { process.kill(saved.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let i = 0; i < 40 && ownedProcess(kind); i++) await delay(100);
    if (ownedProcess(kind)) throw new Error(`${kind} did not stop; check ${logFile(kind)}`);
  }
  fs.rmSync(pidFile(kind), { force: true });
}
function detach(kind, executable, args, env = process.env) {
  fs.mkdirSync(stateDir(), { recursive: true });
  const fd = fs.openSync(logFile(kind), 'a', 0o600);
  const child = spawn(executable, args, { detached: true, stdio: ['ignore', fd, fd], env });
  fs.closeSync(fd);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      try {
        fs.writeFileSync(pidFile(kind), JSON.stringify({ pid: child.pid, start: procStart(child.pid), executable: kind === 'diary' ? cliPath : executable }), { mode: 0o600 });
        child.unref(); resolve();
      } catch (error) { child.kill(); reject(error); }
    });
  });
}
export async function status(cfg = readConfig()) {
  try {
    const r = await fetch(`http://127.0.0.1:${cfg.port}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const s = await r.json();
    return typeof s.db?.count === 'number' && typeof s.tosu?.connected === 'boolean' ? s : null;
  } catch { return null; }
}
export async function tosuAvailable(cfg = readConfig()) {
  if (!cfg.tosuWs) return true;
  return new Promise(resolve => {
    let ws;
    const timer = setTimeout(() => finish(false), 1800);
    const finish = ok => { clearTimeout(timer); if (ws) { ws.onerror = () => {}; ws.close(); } resolve(ok); };
    try { ws = new WebSocket(cfg.tosuWs); ws.onopen = () => finish(true); ws.onmessage = event => {
      try { const d = JSON.parse(event.data); if (d.state || d.beatmap || d.data?.state) finish(true); } catch {}
    }; ws.onerror = () => finish(false); } catch { finish(false); }
  });
}
export async function ensureTosu(cfg = readConfig()) {
  if (!cfg.tosuWs || await tosuAvailable(cfg)) return;
  const url = new URL(cfg.tosuWs);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '24050') {
    console.log(`tosu unavailable at ${cfg.tosuWs}; start your configured reader.`); return;
  }
  if (ownedProcess('tosu')) return;
  const executable = path.join(projectDir, 'vendor/tosu/tosu');
  if (!fs.existsSync(executable)) { console.log('tosu is not bundled in this source checkout; run your own reader.'); return; }
  // Keep bundled tosu configuration separate from any existing installation.
  const isolated = path.join(stateDir(), 'tosu');
  const conf = path.join(isolated, 'config/tosu');
  fs.mkdirSync(conf, { recursive: true });
  fs.writeFileSync(path.join(conf, 'tosu.env'), 'ENABLE_AUTOUPDATE=false\nOPEN_DASHBOARD_ON_STARTUP=false\nSERVER_IP=127.0.0.1\nSERVER_PORT=24050\n');
  await detach('tosu', executable, [], { ...process.env,
    XDG_CONFIG_HOME: path.join(isolated, 'config'), XDG_DATA_HOME: path.join(isolated, 'data'), XDG_CACHE_HOME: path.join(isolated, 'cache') });
  for (let i = 0; i < 8; i++) { if (await tosuAvailable(cfg)) return; if (!ownedProcess('tosu')) break; await delay(250); }
  console.log(`tosu has not become ready; check ${logFile('tosu')} and run osu-diary doctor.`);
}
function q(value) { return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$') + '"'; }
export function writeUnit() {
  if (fs.existsSync(unitFile()) && !ownUnit()) throw new Error(`Existing ${unitFile()} is not managed by this installer; left unchanged. Use osu-diary start or migrate the service manually.`);
  const environment = { OSU_DIARY_CONFIG: configFile(), OSU_DIARY_DATA: readConfig().dataDir };
  for (const key of ['XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'OSU_DIARY_PORT', 'TOSU_WS']) if (process.env[key] !== undefined) environment[key] = process.env[key];
  const envQuote = value => q(value).replace(/\$\$/g, '$');
  const text = `# Managed by osu-diary portable installer\n[Unit]\nDescription=osu-diary score diary\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${q(process.execPath)} ${q(cliPath)} supervise\n${Object.entries(environment).map(([k, v]) => `Environment=${envQuote(`${k}=${v}`)}`).join('\n')}\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`;
  fs.mkdirSync(path.dirname(unitFile()), { recursive: true });
  fs.writeFileSync(unitFile(), text);
}
async function start() {
  const cfg = readConfig(), url = `http://127.0.0.1:${cfg.port}`;
  if (await status(cfg)) { console.log(`Already running: ${url}`); return; }
  if (haveSystemd() && ownUnit()) {
    const r = systemctl('start', unit); if (r.status !== 0) throw new Error(r.stderr || 'Unable to start user service');
  } else {
    await ensureTosu(cfg);
    if (!ownedProcess('diary')) await detach('diary', process.execPath, [cliPath, 'serve']);
  }
  for (let i = 0; i < 40; i++) { if (await status(cfg)) { console.log(`Running: ${url}`); return; } await delay(100); }
  await stopProcess('diary');
  throw new Error(`Diary failed to start (port ${cfg.port} may be occupied). Check osu-diary log.`);
}
async function stop() {
  if (haveSystemd() && ownUnit()) {
    const r = systemctl('stop', unit); if (r.status !== 0) throw new Error(r.stderr);
  }
  await stopProcess('diary'); await stopProcess('tosu');
  console.log('Stopped processes managed by osu-diary.');
}
export async function supervise() {
  await ensureTosu();
  const child = spawn(process.execPath, [cliPath, 'serve'], { stdio: 'inherit' });
  let stopping = false;
  const shutdown = async () => { if (stopping) return; stopping = true; child.kill('SIGTERM'); await stopProcess('tosu'); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', async (code, signal) => { await stopProcess('tosu'); process.exit(stopping ? 0 : (code ?? (signal ? 1 : 0))); });
}
export async function manage(cmd) {
  if (cmd === 'start') return start();
  if (cmd === 'stop') return stop();
  if (cmd === 'restart') { await stop(); return start(); }
  if (cmd === 'enable') {
    if (!haveSystemd()) throw new Error('User systemd is unavailable. Use osu-diary start after logging in.');
    writeUnit(); systemctl('daemon-reload');
    const r = systemctl('enable', '--now', unit); if (r.status !== 0) throw new Error(r.stderr);
    console.log('Login startup enabled.'); return;
  }
  if (cmd === 'disable') {
    if (haveSystemd() && ownUnit()) { const r = systemctl('disable', unit); if (r.status !== 0) throw new Error(r.stderr); }
    console.log('Login startup disabled.'); return;
  }
  if (cmd === 'open') {
    const url = `http://127.0.0.1:${readConfig().port}`;
    const r = spawnSync('xdg-open', [url], { stdio: 'ignore', timeout: 5000 });
    console.log(url); if (r.error && r.error.code !== 'ENOENT') throw r.error; return;
  }
  if (cmd === 'log') {
    const child = haveSystemd() && ownUnit() ? spawn('journalctl', ['--user', '-u', unit, '-n', '80', '-f'], { stdio: 'inherit' }) : spawn('tail', ['-n', '80', '-f', logFile('diary')], { stdio: 'inherit' });
    child.on('error', e => { console.error(e.message); process.exitCode = 1; }); return;
  }
  const cfg = readConfig(), s = await status(cfg);
  console.log(s ? `Running: http://127.0.0.1:${cfg.port} | ${s.db.count} scores | tosu ${s.tosu.connected ? 'connected' : 'disconnected'}` : 'Diary is not running.');
  if (cmd === 'doctor') {
    console.log(`Runtime: ${process.version} (${process.platform}/${process.arch})\nConfiguration: ${configFile()}\nDiary data: ${cfg.dataDir}\nLogs: ${stateDir()}\nUser systemd: ${haveSystemd() ? 'available' : 'unavailable'}\ntosu endpoint: ${cfg.tosuWs || 'disabled'} (${await tosuAvailable(cfg) ? 'reachable' : 'unreachable'})`);
    let scope = 'unavailable'; try { scope = fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim(); } catch {}
    console.log(`Linux memory access: ptrace_scope=${scope}`);
    if (scope !== '0' && scope !== 'unavailable') console.log('Linux may block tosu from reading osu!. For this boot only: sudo sysctl -w kernel.yama.ptrace_scope=0\nThis permits processes running as your user to inspect other same-user processes. Reboot restores the original setting.');
    try { await import('./pp.mjs'); console.log('Native pp module: OK'); } catch (e) { console.log(`Native pp module: ${e.message}`); process.exitCode = 1; }
    try { await import('realm'); console.log('Native Realm module: OK'); } catch (e) { console.log(`Native Realm module: ${e.message}`); process.exitCode = 1; }
    // Realm may leave worker threads alive after module initialization.
    process.exit(process.exitCode || 0);
  }
}
