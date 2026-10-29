import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectDir, configHome } from '../lib/config.mjs';
import { manage } from '../lib/manage.mjs';

export async function uninstall() {
  let install;
  try { install = JSON.parse(fs.readFileSync(path.join(projectDir, 'installation.json'), 'utf8')); }
  catch { throw new Error('This source checkout is not managed by the installer.'); }
  const root = fs.realpathSync(install.root);
  if (!fs.existsSync(path.join(root, '.osu-diary-install')) || !projectDir.startsWith(root + path.sep)) throw new Error('Invalid installation marker; nothing was removed.');
  await manage('disable'); await manage('stop');
  const unit = path.join(configHome(), 'systemd/user/osu-diary.service');
  if (fs.existsSync(unit) && fs.readFileSync(unit, 'utf8').includes('# Managed by osu-diary portable installer')) {
    fs.unlinkSync(unit); spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  }
  if (fs.existsSync(install.launcher) && fs.readFileSync(install.launcher, 'utf8').includes('# Managed by osu-diary portable installer')) fs.unlinkSync(install.launcher);
  fs.rmSync(root, { recursive: true });
  console.log('Program removed. Your diary database, configuration and logs have been kept.');
}
