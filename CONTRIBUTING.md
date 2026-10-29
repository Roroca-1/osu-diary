# Contributing

[Back to osu-diary](README.md)

## Run from source

Use Node.js 24.15+, npm, Python 3.10+, Rust/Cargo and a C toolchain. rosu-pp is compiled during dependency installation.

```fish
git clone https://github.com/Roroca-1/osu-diary.git
cd osu-diary
npm ci
node bin/osu-diary.mjs serve
```

Run tosu separately for live recording. The dashboard is served at `http://127.0.0.1:24051`.

To isolate development data from an existing diary, use runtime overrides:

```fish
env OSU_DIARY_DATA="$PWD/work/diary" OSU_DIARY_CONFIG="$PWD/work/config.json" OSU_DIARY_PORT=24153 TOSU_WS= node bin/osu-diary.mjs serve
```

This example disables the reader. Set `TOSU_WS` to a test reader endpoint when testing recording.

## Checks

```fish
npm test
npm run test:ui
python3 scripts/build-release.py
python3 test/install-test.py dist
```

Unit, recording and UI checks use synthetic scores and isolated data. The install test exercises the built archive in a temporary home. The systemd test is restricted to disposable GitHub Actions runners.

The validation workflow checks full installation on Ubuntu 24.04, Fedora and Arch, plus early rejection of unsupported Ubuntu 22.04. Mock recording and module-loading checks do not replace a real-game play test.

## Releases

The build pins Node.js and tosu versions/checksums in `scripts/versions.json`, installs production dependencies from `package-lock.json`, and bundles the app, runtime and official reader. It produces an archive, checksums and tosu's corresponding source archive under `dist/`.

Before tagging a release, ensure the package version matches the intended `vMAJOR.MINOR.PATCH` tag and validation passes. Pushing the tag runs the release workflow and creates a draft for review. Keep dependency licenses and [third-party notices](THIRD_PARTY_NOTICES.md) with the bundle.

## Documentation and screenshots

Keep both READMEs short and focused on the product. Put detailed user instructions in the English and Chinese guides under `docs/`.

The shared images under `docs/images/` are real browser screenshots with the dashboard's original appearance. Update them using calendar, statistics and beatmap views, with permission to publish any personal score history shown. Never include credentials, settings exports or databases. Keep image framing consistent, ensure covers/charts have loaded, and review the rendered README after updating links.
