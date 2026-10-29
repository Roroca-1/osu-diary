import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const configHome = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
export const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
export const stateDir = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'osu-diary');
export const configFile = () => process.env.OSU_DIARY_CONFIG || path.join(configHome(), 'osu-diary/config.json');

export function readConfig() {
  // Keep old source checkouts working without moving or rewriting their diary.
  const legacyData = path.join(projectDir, 'data');
  const defaults = {
    port: 24051, tosuWs: 'ws://127.0.0.1:24050/websocket/v2',
    dataDir: fs.existsSync(path.join(legacyData, 'diary.db')) ? legacyData : path.join(dataHome(), 'osu-diary'),
    users: '', selfName: '', osuApi: { clientId: '', clientSecret: '' }, osuUser: { id: null, name: '' },
  };
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(configFile(), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read ${configFile()}: ${error.message}`); }
  const cfg = { ...defaults, ...stored };
  if (process.env.OSU_DIARY_PORT !== undefined) cfg.port = Number(process.env.OSU_DIARY_PORT);
  if (process.env.TOSU_WS !== undefined) cfg.tosuWs = process.env.TOSU_WS;
  if (process.env.OSU_DIARY_DATA) cfg.dataDir = process.env.OSU_DIARY_DATA;
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) throw new Error('OSU_DIARY_PORT must be an integer from 0 to 65535');
  cfg.dataDir = path.resolve(cfg.dataDir);
  return cfg;
}

export function saveConfig(patch = {}) {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(configFile(), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  const temporary = `${configFile()}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...stored, ...patch }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, configFile());
}

export function loadConfig() {
  const cfg = readConfig();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  // Runtime overrides are never written to the user's configuration.
  if (!fs.existsSync(configFile())) saveConfig();
  return cfg;
}
