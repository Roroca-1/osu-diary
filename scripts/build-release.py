#!/usr/bin/env python3
"""Build a self-contained Linux x64 release. Requires Python, npm, Rust and a C toolchain."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
PINS = json.loads((ROOT / 'scripts/versions.json').read_text())
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'dist').resolve()
OUT.mkdir(parents=True, exist_ok=True)
CACHE = OUT / '.downloads'
CACHE.mkdir(exist_ok=True)

def download(url, digest):
    dest = CACHE / url.rsplit('/', 1)[1]
    if not dest.exists() or hashlib.sha256(dest.read_bytes()).hexdigest() != digest:
        tmp = dest.with_suffix('.partial')
        print('Downloading', url, flush=True)
        urllib.request.urlretrieve(url, tmp)
        if hashlib.sha256(tmp.read_bytes()).hexdigest() != digest:
            tmp.unlink()
            raise RuntimeError('Checksum mismatch: ' + url)
        tmp.replace(dest)
    return dest

with tempfile.TemporaryDirectory(prefix='osu-diary-build-') as temporary:
    stage = pathlib.Path(temporary) / 'osu-diary'
    stage.mkdir()
    for name in ['bin', 'lib', 'web', 'server.mjs', 'package.json', 'package-lock.json', '.npmrc', 'LICENSE', 'README.md', 'README.zh-CN.md', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'docs']:
        src = ROOT / name
        if src.is_dir(): shutil.copytree(src, stage / name)
        else: shutil.copy2(src, stage / name)
    node_archive = download(f'https://nodejs.org/dist/v{PINS["node"]}/node-v{PINS["node"]}-linux-x64.tar.xz', PINS['nodeSha256'])
    with tarfile.open(node_archive) as archive:
        # Exact official archive verified by pinned SHA-256. Python 3.10's
        # data filter mis-resolves Node's relative npm/npx links.
        archive.extractall(temporary, filter='fully_trusted')
    shutil.move(str(pathlib.Path(temporary) / f'node-v{PINS["node"]}-linux-x64'), stage / 'runtime')
    env = {**os.environ, 'PATH': str(stage / 'runtime/bin') + os.pathsep + os.environ['PATH'], 'REALM_DISABLE_ANALYTICS': '1'}
    subprocess.run([str(stage / 'runtime/bin/npm'), 'ci', '--omit=dev', '--foreground-scripts', '--no-audit', '--no-fund'], cwd=stage, env=env, check=True)
    # Confirm both native dependencies load under the bundled runtime.
    subprocess.run([str(stage / 'runtime/bin/node'), '--input-type=module', '-e', "await import('./server.mjs'); await import('realm'); console.log('Native modules OK'); process.exit(0)"], cwd=stage, env=env, check=True)
    # Rust source/build intermediates are not needed to run rosu-pp.
    shutil.rmtree(stage / 'node_modules/rosu-pp/target', ignore_errors=True)
    # Realm downloads platform headers and binaries for other platforms; retain Linux only.
    prebuilds = stage / 'node_modules/realm/prebuilds'
    if prebuilds.exists():
        for directory in prebuilds.iterdir():
            if directory.name != 'node':
                if directory.is_dir(): shutil.rmtree(directory)
                else: directory.unlink()
    tosu_zip = download(f'https://github.com/tosuapp/tosu/releases/download/v{PINS["tosu"]}/tosu-linux-v{PINS["tosu"]}.zip', PINS['tosuSha256'])
    vendor = stage / 'vendor/tosu'
    vendor.mkdir(parents=True)
    with zipfile.ZipFile(tosu_zip) as archive:
        for entry in archive.infolist():
            if pathlib.PurePosixPath(entry.filename).name == 'tosu':
                (vendor / 'tosu').write_bytes(archive.read(entry))
    if not (vendor / 'tosu').exists(): raise RuntimeError('No tosu binary in official archive')
    (vendor / 'tosu').chmod(0o755)
    # Upstream's license and exact corresponding source are included/referenced.
    license_url = f'https://raw.githubusercontent.com/tosuapp/tosu/v{PINS["tosu"]}/LICENSE'
    (vendor / 'LICENSE').write_bytes(urllib.request.urlopen(license_url, timeout=30).read())
    source_url = f'https://github.com/tosuapp/tosu/archive/refs/tags/v{PINS["tosu"]}.tar.gz'
    source_dest = OUT / f'tosu-{PINS["tosu"]}-source.tar.gz'
    if not source_dest.exists(): urllib.request.urlretrieve(source_url, source_dest)
    (vendor / 'SOURCE.txt').write_text(f'Unmodified official binary: tosu v{PINS["tosu"]}\nCorresponding source: {source_url}\nA copy of the source archive accompanies this release.\n')
    (stage / 'release.json').write_text(json.dumps({'version': VERSION, 'node': PINS['node'], 'tosu': PINS['tosu'], 'platform': 'linux-x64'}, indent=2) + '\n')
    artifact = OUT / f'osu-diary-v{VERSION}-linux-x64.tar.gz'
    with tarfile.open(artifact, 'w:gz', compresslevel=6) as archive: archive.add(stage, arcname='osu-diary')
    assets = [artifact, source_dest]
    (OUT / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in assets))
    print('Built', artifact, flush=True)
