#!/usr/bin/env python3
"""Black-box install tests; all writes and processes use a temporary home."""
import hashlib, http.server, json, os, pathlib, socket, subprocess, sys, tarfile, tempfile, threading, time, pty, select
ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = pathlib.Path(sys.argv[1]).resolve()
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
INSTALL = ROOT / 'install.sh'

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return str(sock.getsockname()[1])

def execute(command, env, ok=True, timeout=90):
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=timeout)
    if ok and result.returncode:
        raise AssertionError(f'{command}: {result.returncode}\n{result.stdout}\n{result.stderr}')
    if not ok and result.returncode == 0:
        raise AssertionError('Expected failure: ' + str(command))
    return result

with tempfile.TemporaryDirectory(prefix='osu diary install tests ') as temp:
    home = pathlib.Path(temp)
    env = {**os.environ, 'HOME': str(home), 'XDG_CONFIG_HOME': str(home/'config'), 'XDG_DATA_HOME': str(home/'share'),
           'XDG_STATE_HOME': str(home/'state'), 'OSU_DIARY_ALLOW_ROOT': '1', 'OSU_DIARY_NO_SYSTEMD': '1',
           'OSU_DIARY_NONINTERACTIVE': '1', 'OSU_DIARY_VERSION': 'v'+VERSION, 'OSU_DIARY_LOCAL_RELEASE': str(DIST),
           'OSU_DIARY_PORT': free_port(), 'TOSU_WS': '', 'OSU_DIARY_PREFIX': str(home/'program files'),
           'OSU_DIARY_BIN_DIR': str(home/'bin folder'), 'OSU_DIARY_CONFIG': str(home/'config/diary.json'),
           'OSU_DIARY_DATA': str(home/'scores')}
    command = home/'bin folder/osu-diary'
    root = home/'program files'
    try:
        execute(['bash', str(INSTALL)], env)
        assert 'Running:' in execute([str(command), 'status'], env).stdout
        execute([str(command), 'doctor'], env)
        tosu_config = home/'tosu probe config/tosu'; tosu_config.mkdir(parents=True)
        tosu_port = free_port()
        (tosu_config/'tosu.env').write_text('ENABLE_AUTOUPDATE=false\nOPEN_DASHBOARD_ON_STARTUP=false\nSERVER_IP=127.0.0.1\nSERVER_PORT='+tosu_port+'\n')
        tosu_log = home/'tosu-probe.log'
        with tosu_log.open('w') as log:
            reader = subprocess.Popen([str(root/'current/vendor/tosu/tosu')], env={**env, 'LD_LIBRARY_PATH':str(root/'current/vendor/compat/lib'), 'XDG_CONFIG_HOME':str(tosu_config.parent), 'XDG_DATA_HOME':str(home/'tosu probe data'), 'XDG_CACHE_HOME':str(home/'tosu probe cache')}, stdout=log, stderr=log)
            try:
                for _ in range(80):
                    try:
                        import urllib.request
                        with urllib.request.urlopen('http://127.0.0.1:'+tosu_port+'/', timeout=1) as r:
                            assert r.status == 200
                        check = execute([str(command), 'doctor'], {**env, 'TOSU_WS':'ws://127.0.0.1:'+tosu_port+'/websocket/v2'})
                        assert '(reachable)' in check.stdout, check.stdout
                        break
                    except Exception:
                        if reader.poll() is not None: raise AssertionError('tosu exited: '+tosu_log.read_text())
                        time.sleep(0.25)
                else: raise AssertionError('tosu did not start: '+tosu_log.read_text())
            finally:
                reader.terminate()
                try: reader.wait(timeout=10)
                except subprocess.TimeoutExpired: reader.kill(); reader.wait()
        print('PASS: bundled tosu starts its dashboard without a running game', flush=True)
        previous = os.readlink(root/'current')
        # Configure and import synthetic data, then verify reinstall preserves both.
        cfg = pathlib.Path(env['OSU_DIARY_CONFIG'])
        cfg.write_text(json.dumps({'users':'SyntheticPlayer'}))
        legacy = home/'legacy.csv'
        legacy.write_text('date,ar,bpm,stars,map,mods,acc,miss,notes\n2026-01-01,9,180,5,Example - Song [Insane],HD,98,1,test\n')
        execute([str(command), 'import', 'csv', str(legacy)], env)
        execute(['bash', str(INSTALL)], env)
        assert os.readlink(root/'current') != previous
        assert json.loads(cfg.read_text())['users'] == 'SyntheticPlayer'
        assert '1 scores' in execute([str(command), 'status'], env).stdout
        print('PASS: first install, paths with spaces, detached start, doctor, reinstall and data preservation', flush=True)
        # Permission denial is simulated through a PTY; no real sudo or sysctl runs.
        mockbin = home/'mockbin'; mockbin.mkdir()
        (mockbin/'cat').write_text('#!/bin/sh\nif [ "$1" = /proc/sys/kernel/yama/ptrace_scope ]; then echo 1; else exec /bin/cat "$@"; fi\n')
        (mockbin/'sudo').write_text('#!/bin/sh\necho "simulated sudo denial" >&2\nexit 1\n')
        for f in mockbin.iterdir(): f.chmod(0o755)
        permission_env = {**env, 'PATH':str(mockbin)+os.pathsep+env['PATH'], 'OSU_DIARY_NONINTERACTIVE':'0', 'OSU_DIARY_NO_START':'1'}
        pid, fd = pty.fork()
        if pid == 0:
            os.execve('/bin/bash', ['bash', str(INSTALL)], permission_env)
        output = b''; answered = False; deadline = time.monotonic()+90
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], 1)
            if ready:
                try: chunk = os.read(fd, 8192)
                except OSError: break
                if not chunk: break
                output += chunk
                if b'Apply this temporary change using sudo?' in output and not answered:
                    os.write(fd, b'y\n'); answered = True
        else:
            os.kill(pid, 15); raise AssertionError('Permission prompt timed out')
        os.close(fd); _, code = os.waitpid(pid, 0)
        assert os.waitstatus_to_exitcode(code) == 0, output.decode(errors='replace')
        assert b'Permission change failed' in output and answered, output.decode(errors='replace')
        assert command.exists()
        execute([str(command), 'start'], env)
        print('PASS: denied sudo leaves the installation usable', flush=True)
        current = os.readlink(root/'current')
        # Corrupt downloads must not change the active installation.
        bad = home/'bad-release'; bad.mkdir()
        archive = DIST/f'osu-diary-v{VERSION}-linux-x64.tar.gz'
        (bad/archive.name).write_bytes(b'incomplete download')
        (bad/'SHA256SUMS').write_text((DIST/'SHA256SUMS').read_text())
        execute(['bash', str(INSTALL)], {**env, 'OSU_DIARY_LOCAL_RELEASE': str(bad)}, ok=False)
        assert os.readlink(root/'current') == current
        assert 'Running:' in execute([str(command), 'status'], env).stdout
        print('PASS: interrupted/corrupt download leaves the active installation running', flush=True)
        # Force startup failure while a different service occupies the configured port.
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self): self.send_response(200); self.end_headers(); self.wfile.write(b'unrelated')
            def log_message(self, *args): pass
        occupied = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=occupied.serve_forever, daemon=True).start()
        try:
            result = execute(['bash', str(INSTALL)], {**env, 'OSU_DIARY_PORT': str(occupied.server_port)}, ok=False)
            assert 'restoring the previous' in result.stderr, result.stderr
            assert os.readlink(root/'current') == current
        finally: occupied.shutdown(); occupied.server_close()
        execute([str(command), 'start'], env)
        print('PASS: occupied-port update restores the previous program', flush=True)
        # Existing unmanaged startup integration must never be overwritten.
        unit = home/'config/systemd/user/osu-diary.service'; unit.parent.mkdir(parents=True, exist_ok=True)
        unit.write_text('# existing user service\n')
        execute(['bash', str(INSTALL)], env)
        assert unit.read_text() == '# existing user service\n'
        print('PASS: existing unmanaged systemd service preserved', flush=True)
        execute([str(command), 'uninstall'], env)
        assert not command.exists() and not root.exists()
        assert cfg.exists() and (home/'scores/diary.db').exists()
        assert unit.read_text() == '# existing user service\n'
        print('PASS: uninstall keeps diary data, config and unmanaged services', flush=True)
    finally:
        if command.exists(): execute([str(command), 'stop'], env, timeout=30)
