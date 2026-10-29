English / 简体中文 support and clearer statistics for osu-diary.

- Switch language in the header without losing your filters, chart choices or unfinished settings. Dates, numbers, errors and job progress follow your language.
- Per-play pp and daily best now share a real calendar-time axis. Accuracy shows daily average and best, with a full 0–100% option.
- AR and BPM have Plays / Accuracy views, coarse and fine groups, detailed tooltips and matching score drilldowns. Tempo & Accuracy explains its 95% reference line.
- Responsive SVG charts support hover, tap and keyboard exploration. All aggregates use every matching score; large scatter plots clearly label sampling.
- Updated bilingual guides and screenshots are included in the archive. Existing scores and configuration are preserved; no database migration is required.

Install or update in fish, bash or zsh:

```sh
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | bash
```

Supports modern x86-64 Linux with glibc 2.38+ (Ubuntu 24.04, Fedora and Arch). Ubuntu 22.04, Windows, ARM and Alpine remain unsupported. Node.js and the official tosu reader are bundled.

Validation includes synthetic recording, bilingual UI, statistics edge cases, packaged install/update/rollback and systemd lifecycle checks. Real-game recording still depends on tosu compatibility with your osu! build; automated checks do not replace a live play test.

The accompanying `tosu-4.26.3-source.tar.gz` is the corresponding source for the unmodified bundled reader. Dependency licenses remain in the archive.
