First public Linux release of osu-diary.

Install in fish, bash or zsh:

```sh
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | bash
```

The archive includes Node.js, native libraries, and tosu. Users do not need npm, Rust or Git. Supports x86-64 glibc Linux; Windows, ARM and Alpine are deferred.

Includes portable lifecycle commands, user login startup, isolated tosu settings, update rollback, and synthetic recording/UI tests. The installer asks before requesting a temporary Linux memory-access permission change. Data/configuration are retained on update and uninstall.

The dashboard currently uses Chinese. Real-game recording depends on tosu's support for the installed osu! build; mock recording tests do not replace a play test. See README.md for data locations, diagnostics and prerequisites.

`tosu-4.26.3-source.tar.gz` contains the corresponding source for the unmodified bundled tosu executable. Bundled dependency licenses remain in the archive.

`gcc-13.4.0-source.tar.xz` contains source for the bundled C++ compatibility runtime; its licenses and conda-forge build recipes are included in the app archive.
