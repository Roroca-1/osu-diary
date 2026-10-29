// 封面缓存：优先 assets.ppy.sh 的谱面封面，失败则回退本地谱面背景，再不行返回空
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function coverDir(dataDir) {
  return path.join(dataDir || path.join(os.homedir(), '.local/share/osu-diary'), 'covers');
}

function coverPath(dir, setId, kind) {
  return path.join(dir, `${setId}.${kind === 'local' ? 'local.' : ''}jpg`);
}

export function hasCover(dir, setId) {
  return fs.existsSync(coverPath(dir, setId, 'web')) || fs.existsSync(coverPath(dir, setId, 'local'));
}

export function coverFile(dir, setId) {
  if (fs.existsSync(coverPath(dir, setId, 'web'))) return coverPath(dir, setId, 'web');
  if (fs.existsSync(coverPath(dir, setId, 'local'))) return coverPath(dir, setId, 'local');
  return null;
}

/**
 * 拉取并缓存一张封面。
 * 1) 已有缓存 → true
 * 2) assets.ppy.sh 官方封面 → 存 {id}.jpg
 * 3) 本地谱面背景文件（lazer 的 files 目录）→ 存 {id}.local.jpg
 * 4) 都失败 → false（前端用占位图）
 */
export async function fetchCover(dir, setId, localBgFile) {
  if (setId == null || setId <= 0) return tryLocalOnly(dir, setId, localBgFile);
  if (coverFile(dir, setId)) return true;

  const url = `https://assets.ppy.sh/beatmaps/${setId}/covers/cover@2x.jpg`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1000) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(coverPath(dir, setId, 'web'), buf);
        return true;
      }
    }
  } catch { /* 离线等情况，走本地回退 */ }

  return tryLocalOnly(dir, setId, localBgFile);
}

async function tryLocalOnly(dir, setId, localBgFile) {
  if (!localBgFile) return false;
  try {
    const st = fs.statSync(localBgFile);
    if (st.size > 1000) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(localBgFile, coverPath(dir, setId, 'local'));
      return true;
    }
  } catch { return false; }
  return false;
}
