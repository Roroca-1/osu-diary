#!/usr/bin/env bash
set -euo pipefail

# This bootstrap needs only tools normally present on a Linux desktop.
# Example: curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | bash
fail() { printf 'osu-diary: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail 'This release supports x86-64 Linux only.'
for tool in curl tar sha256sum mktemp; do command -v "$tool" >/dev/null || fail "Install the required utility: $tool"; done
if ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then fail 'This release requires glibc Linux; Alpine/musl is not supported.'; fi
glibc=$(getconf GNU_LIBC_VERSION)
[[ $glibc =~ ^glibc\ ([0-9]+)\.([0-9]+) ]] || fail 'Unable to determine the glibc version.'
(( BASH_REMATCH[1] > 2 || (BASH_REMATCH[1] == 2 && BASH_REMATCH[2] >= 38) )) || fail 'The bundled tosu requires glibc 2.38 or newer. Use Ubuntu 24.04+ or a current Fedora/Arch desktop; Ubuntu 22.04 is not supported.'
[[ ${EUID:-$(id -u)} != 0 ]] || [[ ${OSU_DIARY_ALLOW_ROOT:-0} == 1 ]] || fail 'Run this installer as your normal user, without sudo.'

release=${OSU_DIARY_VERSION:-latest}
if [[ $release != latest && ! $release =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then fail 'OSU_DIARY_VERSION must be latest or vMAJOR.MINOR.PATCH.'; fi
base=https://github.com/Roroca-1/osu-diary/releases
if [[ $release == latest ]]; then
    resolved=$(curl --fail --silent --show-error --location --output /dev/null --write-out '%{url_effective}' "$base/latest")
    release=${resolved##*/}
    [[ $release =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'No published Linux release was found.'
fi
asset="osu-diary-$release-linux-x64.tar.gz"
base="$base/download/$release"
# Local release fixtures are useful for offline validation; remote overrides are deliberately unsupported.
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
if [[ -n ${OSU_DIARY_LOCAL_RELEASE:-} ]]; then
    cp -- "$OSU_DIARY_LOCAL_RELEASE/$asset" "$OSU_DIARY_LOCAL_RELEASE/SHA256SUMS" "$tmp/"
else
    printf 'Downloading osu-diary %s…\n' "$release"
    curl --fail --show-error --location --retry 3 "$base/$asset" --output "$tmp/$asset"
    curl --fail --silent --show-error --location --retry 3 "$base/SHA256SUMS" --output "$tmp/SHA256SUMS"
fi
expected=$(awk -v file="$asset" '$2 == file { print $1 }' "$tmp/SHA256SUMS")
[[ $expected =~ ^[0-9a-f]{64}$ ]] || fail 'The release checksum is missing or invalid.'
printf '%s  %s\n' "$expected" "$tmp/$asset" | sha256sum --check --status || fail 'Download checksum verification failed.'
tar -xzf "$tmp/$asset" -C "$tmp"
[[ -x $tmp/osu-diary/runtime/bin/node ]] || fail 'The archive has no bundled Node.js runtime.'
"$tmp/osu-diary/runtime/bin/node" "$tmp/osu-diary/bin/setup.mjs" "$tmp/osu-diary"

scope=$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || true)
if [[ -n $scope && $scope != 0 ]]; then
    printf '\nLinux may block tosu from reading osu!.\n'
    printf 'For this boot, kernel.yama.ptrace_scope=0 allows your processes to inspect other processes owned by your user. Reboot restores the original setting.\n'
    if [[ ${OSU_DIARY_NONINTERACTIVE:-0} != 1 && -r /dev/tty && -w /dev/tty ]]; then
        answer=''
        { printf 'Apply this temporary change using sudo? [y/N] ' >/dev/tty; read -r answer </dev/tty; } 2>/dev/null || true
        if [[ $answer == y || $answer == Y ]]; then
            if ! sudo sysctl -w kernel.yama.ptrace_scope=0; then
                printf 'Permission change failed. osu-diary remains installed; run osu-diary doctor for help.\n' >&2
            fi
        fi
    fi
    printf 'If needed later: sudo sysctl -w kernel.yama.ptrace_scope=0\n'
fi
