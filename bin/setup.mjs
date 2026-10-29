#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { dataHome, configHome } from '../lib/config.mjs';

const source = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'release.json'), 'utf8'));
const root = path.resolve(process.env.OSU_DIARY_PREFIX || path.join(dataHome(), 'osu-diary/program'));
const binDir = path.resolve(process.env.OSU_DIARY_BIN_DIR || path.join(os.homedir(), '.local/bin'));
const launcher = path.join(binDir, 'osu-diary');
const current = path.join(root, 'current');
const marker = path.join(root, '.osu-diary-install');
const unit = path.join(configHome(), 'systemd/user/osu-diary.service');
const unitBefore = fs.existsSync(unit) ? fs.readFileSync(unit, 'utf8') : null;
const serviceAvailable = () => process.env.OSU_DIARY_NO_SYSTEMD !== '1' && spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore', timeout: 5000 }).status === 0;
const run = (directory, args) => spawnSync(path.join(directory, 'runtime/bin/node'), [path.join(directory, 'bin/osu-diary.mjs'), ...args], { stdio: 'inherit', timeout: 45000 });
const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";

if (fs.existsSync(root) && !fs.existsSync(marker) && fs.readdirSync(root).length) throw new Error(`Refusing to replace an unmanaged directory: ${root}`);
let launcherBefore = null;
if (fs.existsSync(launcher)) {
  launcherBefore = fs.readFileSync(launcher, 'utf8');
  if (!launcherBefore.includes('# Managed by osu-diary portable installer')) throw new Error(`Existing ${launcher} is not managed by osu-diary; choose another OSU_DIARY_BIN_DIR.`);
}
let previous = null;
try { previous = fs.readlinkSync(current); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`${current} must be an installer-managed symlink`); }
fs.mkdirSync(path.join(root, 'releases'), { recursive: true });
fs.mkdirSync(binDir, { recursive: true });
const candidate = fs.mkdtempSync(path.join(root, 'releases', `v${manifest.version}-`));
const previousDir = previous ? path.resolve(root, previous) : null;
let activated = false;
try {
  fs.cpSync(source, candidate, { recursive: true, verbatimSymlinks: true });
  const check = spawnSync(path.join(candidate, 'runtime/bin/node'), ['--input-type=module', '-e', "await import('./server.mjs'); await import('realm'); process.exit(0)"], { cwd: candidate, timeout: 20000, encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`The bundled runtime or native libraries cannot run on this Linux system: ${check.stderr}`);
  fs.writeFileSync(path.join(candidate, 'installation.json'), JSON.stringify({ root, launcher }, null, 2));
  if (previousDir && run(previousDir, ['stop']).status !== 0) throw new Error('Could not stop the previous installation; update cancelled.');
  const link = `${current}.${process.pid}.tmp`;
  fs.symlinkSync(path.relative(root, candidate), link);
  fs.renameSync(link, current);
  activated = true;
  fs.writeFileSync(marker, 'osu-diary portable installation\n');
  const wrapper = `#!/bin/sh\n# Managed by osu-diary portable installer\nexec ${shellQuote(path.join(current, 'runtime/bin/node'))} ${shellQuote(path.join(current, 'bin/osu-diary.mjs'))} "$@"\n`;
  fs.writeFileSync(`${launcher}.tmp`, wrapper, { mode: 0o755 });
  fs.chmodSync(`${launcher}.tmp`, 0o755);
  fs.renameSync(`${launcher}.tmp`, launcher);
  if (process.env.OSU_DIARY_NO_START !== '1') {
    const canManageUnit = unitBefore === null || unitBefore.includes('# Managed by osu-diary portable installer');
    const args = serviceAvailable() && canManageUnit ? ['enable'] : ['start'];
    if (run(current, args).status !== 0) throw new Error('Startup failed; restoring the previous program.');
    // enable --now may return before startup has finished; verify readiness.
    if (run(current, ['start']).status !== 0) throw new Error('The diary did not become ready.');
    if (!canManageUnit) console.log('Your existing user service was preserved. Use doctor to check which instance is running.');
  }
} catch (error) {
  if (activated) {
    run(current, ['stop']);
    if (previous !== null) {
      const rollback = `${current}.${process.pid}.rollback`;
      fs.symlinkSync(previous, rollback); fs.renameSync(rollback, current);
    } else fs.rmSync(current, { force: true });
    if (launcherBefore !== null) fs.writeFileSync(launcher, launcherBefore, { mode: 0o755 });
    else fs.rmSync(launcher, { force: true });
    if (unitBefore !== null) fs.writeFileSync(unit, unitBefore);
    else fs.rmSync(unit, { force: true });
    if (serviceAvailable()) spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    if (previousDir && process.env.OSU_DIARY_NO_START !== '1') run(previousDir, ['start']);
  }
  fs.rmSync(candidate, { recursive: true, force: true });
  throw error;
}
console.log(`\nInstalled osu-diary ${manifest.version}\nCommand: ${launcher}\nDashboard: http://127.0.0.1:${(await import('../lib/config.mjs')).readConfig().port}\nData and configuration are preserved on updates.\nRun: ${shellQuote(launcher)} doctor`);
if (!process.env.PATH.split(path.delimiter).includes(binDir)) console.log(`\nAdd the command to fish's PATH: fish_add_path ${shellQuote(binDir)}\nFor bash/zsh, add ${binDir} to PATH, or use the full command path above.`);
