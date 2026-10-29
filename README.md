# osu-diary

A local **osu!lazer score diary** for Linux: automatically record plays, browse a calendar of your sessions, and track pp, accuracy, AR, BPM and mods in a browser dashboard.

[中文说明](README.zh-CN.md) · [Releases](https://github.com/Roroca-1/osu-diary/releases)

## Install on Linux

Run as your normal user in fish, bash or zsh:

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | bash
```

The download includes Node.js, native calculation/import libraries, and the official tosu memory reader. **No Node.js, npm, Rust or Git installation is required.** The installer starts the diary and enables login startup when a systemd user session is available. Without systemd, it starts in the background; use `osu-diary start` after logging in again.

Requirements: **x86-64 glibc Linux**, bash, curl, tar, gzip, coreutils and a browser. Release checks cover Ubuntu 22.04/24.04, Fedora and Arch. Windows, ARM and Alpine/musl are not supported yet. Running the installer as root is intentionally rejected.

Open **http://127.0.0.1:24051**. Launch osu!lazer normally and play a map. A running tosu endpoint on port 24050 is reused; otherwise the bundled copy is started with its own configuration. osu! API credentials are optional, only for refreshing submitted scores with official pp.

Linux may restrict reading another process's memory. The installer explains the setting and asks before requesting sudo for a **temporary, until-reboot** change. Declining does not cancel installation. `osu-diary doctor` distinguishes a missing reader from blocked memory access. To permit access for the current boot:

```fish
sudo sysctl -w kernel.yama.ptrace_scope=0
```

This allows processes owned by your user to inspect other same-user processes. The installer never creates a persistent system permission override. After reboot you may need to run this again. Permissions alone do not prove that tosu is compatible with your current osu! build.

If the installer says the command is not on PATH, use the printed full path or:

```fish
fish_add_path ~/.local/bin
```

For a noninteractive install, leave permission changes for later:

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | env OSU_DIARY_NONINTERACTIVE=1 bash
```

## Commands

```fish
osu-diary start       # Start the diary and reuse/start tosu
osu-diary open        # Open the dashboard
osu-diary status      # Score count and reader connection
osu-diary doctor      # Diagnose runtime, reader and Linux permissions
osu-diary log         # Follow diary logs
osu-diary stop        # Stop only processes owned by this installation
osu-diary restart
osu-diary enable      # Enable login startup using systemd --user
osu-diary disable    # Disable login startup without deleting scores
osu-diary serve      # Foreground server; run tosu separately

osu-diary import realm             # Import historical lazer scores
osu-diary import realm /path/to/client.realm
osu-diary import realm --keep PlayerOne,PlayerTwo
osu-diary import pp                # Recalculate imported pp locally
osu-diary import csv /path/to/legacy.csv
osu-diary export /path/to/scores.csv
```

Historical imports preserve original score dates and skip duplicates. The CSV importer accepts the old nine-column `date,ar,bpm,stars,map,mods,acc,miss,notes` format; exported CSV uses the richer diary schema and is not a backup-import format. Back up `diary.db` with the diary stopped to retain every field.

The dashboard and feature descriptions currently use Chinese. The CLI installer and troubleshooting messages use English. Tracking/import primarily targets osu!standard on lazer; other rulesets are outside the initial release's support.

## Data, updates and removal

| Files | Default location |
|---|---|
| Scores and cover cache | `~/.local/share/osu-diary/` |
| Program releases | `~/.local/share/osu-diary/program/` |
| Configuration (including optional API credentials) | `~/.config/osu-diary/config.json` |
| Logs, process state and isolated tosu files | `~/.local/state/osu-diary/` |
| Command | `~/.local/bin/osu-diary` |

XDG base directories are honored. `OSU_DIARY_CONFIG`, `OSU_DIARY_DATA`, `OSU_DIARY_PORT` and `TOSU_WS` override runtime settings and are never saved automatically. A custom lazer storage location is detected from `storage.ini`; Realm import also accepts an explicit path. Existing source checkouts with `data/diary.db` continue using that directory by default.

Rerun the install command to update. Downloads are checksum verified and checked before switching the active version. The previous program is retained; failed startup restores it. Scores and configuration are kept. An existing unmanaged command/service is not overwritten. If you have an old fish function named `osu-diary`, it can shadow the installed executable: use `~/.local/bin/osu-diary` until you intentionally migrate that function.

```fish
osu-diary uninstall
```

This removes installer-managed program files and startup integration, **keeping scores, configuration and logs**. No root access is needed. Set `OSU_DIARY_VERSION=v1.0.0` when running the installer to select a specific release; `OSU_DIARY_PREFIX` and `OSU_DIARY_BIN_DIR` customize program/command locations.

Everything listens on loopback. Your scores stay local. Cover art is fetched from `assets.ppy.sh`; tosu may download offsets and calculate pp; optional online pp refresh contacts osu!'s API. This is a personal local application, not an authenticated multi-user web service: do not expose it through a public proxy.

## Development and validation

Requires Node.js 24.15+, npm, Python 3.10+, zstd, Rust/Cargo and a C toolchain because rosu-pp is compiled from source. Use a clean checkout; do not commit your database or credentials.

```fish
npm ci
npm test
npm run test:ui
node bin/osu-diary.mjs serve
python3 scripts/build-release.py
```

The release build pins Node.js and tosu versions/checksums in `scripts/versions.json`, bundles production dependencies, and includes licenses plus corresponding source archives for tosu and the bundled GCC runtime. The compatibility runtime is scoped to tosu; no system libraries are replaced. CI checks the archive on clean Linux distributions and uses synthetic scores for recording/UI tests. Real-game memory reading still depends on osu!/tosu compatibility and requires a separate play test.

## License

MIT for osu-diary. Bundled dependencies retain their licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Independent project, not affiliated with osu!, ppy or tosu.
