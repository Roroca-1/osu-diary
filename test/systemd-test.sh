#!/usr/bin/env bash
set -euo pipefail
# Run only in a disposable GitHub Actions VM, never against a personal service.
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'This test requires a disposable GitHub Actions VM.' >&2; exit 1; }
[[ ! -e $HOME/.config/systemd/user/osu-diary.service ]] || { echo 'Existing user unit; refusing test.' >&2; exit 1; }
tmp=$(mktemp -d)
export OSU_DIARY_PREFIX="$tmp/program files \$cash%" OSU_DIARY_BIN_DIR="$tmp/bin folder \$cash%"
export OSU_DIARY_DATA="$tmp/scores" OSU_DIARY_CONFIG="$tmp/config.json"
export OSU_DIARY_LOCAL_RELEASE="$PWD/dist" OSU_DIARY_VERSION=v1.0.0
export OSU_DIARY_NONINTERACTIVE=1 TOSU_WS=''
export OSU_DIARY_PORT
OSU_DIARY_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
command="$OSU_DIARY_BIN_DIR/osu-diary"
cleanup() {
    if [[ $? != 0 ]]; then journalctl --user -u osu-diary.service --no-pager -n 100 || true; fi
    if [[ -x $command ]]; then "$command" uninstall; fi
    rm -rf -- "$tmp"
}
trap cleanup EXIT
bash install.sh
systemctl --user is-enabled osu-diary.service
systemctl --user is-active osu-diary.service
"$command" status
"$command" restart
"$command" stop
if systemctl --user is-active --quiet osu-diary.service; then echo 'Unit did not stop' >&2; exit 1; fi
"$command" start
"$command" disable
if systemctl --user is-enabled --quiet osu-diary.service; then echo 'Unit was not disabled' >&2; exit 1; fi
"$command" enable
# Upgrade while the user service is enabled, then confirm the new unit works.
bash install.sh
systemctl --user is-active osu-diary.service
"$command" status
"$command" uninstall
[[ ! -e $HOME/.config/systemd/user/osu-diary.service ]]
[[ -f $OSU_DIARY_DATA/diary.db ]]
echo 'PASS: real systemd enable/start/restart/stop/disable/update/uninstall'
