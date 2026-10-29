# Third-party software

osu-diary's own code is MIT licensed. Bundled dependencies retain their own licenses.
Their copyright and license files are included with the installed packages.

- Node.js 24.22.2: MIT and bundled third-party notices, included at `runtime/LICENSE`.
  Source: https://github.com/nodejs/node/tree/v24.22.2
- tosu 4.26.3: LGPL-3.0, included at `vendor/tosu/LICENSE`.
  The official Linux binary is distributed unchanged as a separate executable.
  Corresponding source is provided as a release asset `tosu-4.26.3-source.tar.gz`.
  Upstream: https://github.com/tosuapp/tosu/tree/v4.26.3
  Users may replace the executable at `vendor/tosu/tosu` with their own compatible build.
- GCC 13.4 runtime libraries (conda-forge builds): GPL-3.0-only WITH GCC-exception-3.1.
  Package licenses, build recipes and patches are retained at `vendor/compat/notices/`.
  Corresponding GCC source accompanies the release as `gcc-13.4.0-source.tar.xz`.
  Source: https://ftp.gnu.org/gnu/gcc/gcc-13.4.0/
  Packaging: https://github.com/conda-forge/ctng-compilers-feedstock
  These libraries are used only by the bundled tosu process.
- Realm JS 12.15.0 and Realm Core: Apache-2.0; package notices are retained.
  https://github.com/realm/realm-js
- rosu-pp 0.9.4: MIT. https://github.com/MaxOhn/rosu-pp-js
- picocolors: ISC. https://github.com/alexeyraspopov/picocolors

Other transitive package license files remain under `node_modules/` in the Linux archive.
The release workflow installs the exact dependency versions in package-lock.json.
osu-diary is an independent project and is not affiliated with osu!, ppy, or tosu.
