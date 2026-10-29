# User guide

[Back to osu-diary](../README.md) · [简体中文](usage.zh-CN.md)

## Install and start

Run the installer as your normal user in fish, bash or zsh:

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | bash
```

Requirements: x86-64 Linux with glibc 2.38+, bash, curl, tar, gzip, coreutils and a browser. Ubuntu 24.04, Fedora and Arch are tested. Ubuntu 22.04, Windows, ARM and Alpine/musl are unsupported.

The archive includes Node.js, native libraries and the official tosu reader. The installer starts the diary and enables login startup when a systemd user session is available. Otherwise, run `osu-diary start` after logging in. Open [the dashboard](http://127.0.0.1:24051) and launch osu!lazer normally.

A working tosu endpoint on port 24050 is reused. Otherwise, the bundled reader starts with its own configuration. Tracking and historical import primarily target osu!standard on lazer. Choose English or 简体中文 in the header. On first use, the dashboard follows your browser’s preferred English/Chinese language, defaulting to English. Explicit choices are remembered when browser storage is available. Installer and diagnostic messages use English.

If the command is not on PATH, use the full path printed by the installer. In fish:

```fish
fish_add_path ~/.local/bin
```

## Linux memory access

Linux may prevent tosu from reading osu!'s memory. The installer explains this and asks before requesting sudo for a temporary change. Declining leaves the diary installed. Run `osu-diary doctor` to check the reader connection and permission setting.

To allow access for the current boot:

```fish
sudo sysctl -w kernel.yama.ptrace_scope=0
```

This allows processes running as your user to inspect other same-user processes. Reboot restores the original setting; you may need to run the command again. The installer does not create a persistent system override. A connected reader does not by itself prove that it can read your current osu! build.

For unattended installation without a permission prompt:

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | env OSU_DIARY_NONINTERACTIVE=1 bash
```

## Everyday commands

```fish
osu-diary start       # Start the diary and reuse/start tosu
osu-diary open        # Open the dashboard
osu-diary status      # Score count and reader connection
osu-diary doctor      # Runtime, reader and permission checks
osu-diary log         # Follow diary logs
osu-diary stop        # Stop installer-managed processes
osu-diary restart
osu-diary enable      # Enable login startup with systemd --user
osu-diary disable     # Disable login startup
osu-diary serve       # Foreground server; run tosu separately
```

## Import and export

Close osu!lazer before importing its history. In the dashboard, open **Settings → Import history**, or use:

```fish
osu-diary import realm
osu-diary import realm /path/to/client.realm
osu-diary import realm --keep PlayerOne,PlayerTwo
osu-diary import pp
osu-diary import csv /path/to/legacy.csv
osu-diary export /path/to/scores.csv
```

Realm import preserves original score dates, identifies the main player and skips duplicates. A custom lazer storage location is detected from `storage.ini`; an explicit Realm path is also accepted.

Legacy CSV import accepts `date,ar,bpm,stars,map,mods,acc,miss,notes`. Exported CSV contains more fields and is not a backup-import format. For a complete backup, stop the diary and copy `diary.db` to a safe location.

Optional osu! API credentials in **Settings → Official pp refresh** let you refresh submitted scores with official pp. They are not needed for recording plays. Local historical pp calculations may differ from the current official algorithm.

Use **Settings → Player filter** to choose which players to record. Automatic filtering uses the live game profile and the identity detected during history import.

## Reading the charts

Select all time or a rolling 7/30/90-day range. Switching language keeps your page, filters, chart choices and unsaved settings.

- **pp per play:** each pink dot is a play; yellow markers show the daily best at local noon. Both use the same calendar-time axis. Lines stop across days without records. This is per-play pp, not account pp.
- **Accuracy over time:** solid blue is the daily mean, dashed pink the daily best. Use **Full 0–100%** to compare against a fixed scale; **Data range** zooms to the displayed values.
- **AR / BPM profile:** **Plays** counts scores; **Accuracy** shows the average of scores with known accuracy. Hover, tap or focus a group for its bounds, score count, sample count, average accuracy and best pp. Click it or press Enter/Space for the matching scores. Groups include their lower bound and exclude their upper bound.
- Default groups are 0.5 AR / 10 BPM. Choose 0.1 AR / 1 BPM for detail; narrower screens scroll the chart horizontally.
- **Tempo & Accuracy:** one dot per play; the dashed 95% line is a visual reference, not a difficulty threshold. Focus the pp or tempo chart and use left/right arrows to explore plays; Enter opens the beatmap.

Missing values are excluded only from the affected metric. Averages and group counts use every matching score. For more than 6,000 points, scatter charts display a labeled sample preserving time coverage and metric extremes. Calendar dates use the diary server’s timezone; dates and numbers follow the selected language.

## Files and configuration

| Files | Default location |
|---|---|
| Scores and covers | `~/.local/share/osu-diary/` |
| Installed program | `~/.local/share/osu-diary/program/` |
| Configuration and optional API credentials | `~/.config/osu-diary/config.json` |
| Logs, process state and isolated tosu files | `~/.local/state/osu-diary/` |
| Command | `~/.local/bin/osu-diary` |

XDG base directories are honored. `OSU_DIARY_CONFIG`, `OSU_DIARY_DATA`, `OSU_DIARY_PORT` and `TOSU_WS` override settings at runtime and are not saved automatically. Existing source checkouts with `data/diary.db` keep using that directory by default.

Keep custom data, configuration and log directories outside the program prefix. The installer and uninstaller reject overlapping locations to protect active data.

## Update or remove

Rerun the installation command to update. Downloads are checksum verified before activation; failed startup restores the previous program. Data and configuration are retained.

```fish
osu-diary uninstall
```

Uninstall removes installer-managed program files and startup integration, keeping diary data, configuration and logs.

To select a release, pass `OSU_DIARY_VERSION` to the installer:

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | env OSU_DIARY_VERSION=v1.1.0 bash
```

`OSU_DIARY_PREFIX` and `OSU_DIARY_BIN_DIR` customize program and command locations. Existing unmanaged commands and services are preserved. A shell function with the same name may shadow the installed command; use `~/.local/bin/osu-diary` to access the executable directly.

## Privacy and troubleshooting

Scores are stored locally. Cover art is fetched from `assets.ppy.sh`; tosu may download offsets and check for updates; optional official pp refresh contacts osu!'s API. Configuration can contain API credentials, so do not publish it.

The app listens on loopback and is intended for personal local use. Do not expose it through a public proxy.

If new plays do not appear, run `osu-diary doctor`, check that osu!lazer and tosu are running, and inspect `osu-diary log`. Reader compatibility can change with osu! updates. Historical imports need a compatible `client.realm`; real-game recording depends on the installed osu!/tosu versions.
