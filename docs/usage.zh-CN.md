# 使用指南

[返回 osu-diary](../README.zh-CN.md) · [English](usage.md)

## 安装与启动

以普通用户身份在 fish、bash 或 zsh 中运行：

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | bash
```

需要 x86-64 Linux、glibc 2.38+，以及 bash、curl、tar、gzip、coreutils 和浏览器。已测试 Ubuntu 24.04、Fedora、Arch；暂不支持 Ubuntu 22.04、Windows、ARM、Alpine/musl。

安装包自带 Node.js、原生依赖和 tosu。安装器会启动日记；有 systemd 用户会话时也会设置登录自启。没有 systemd 时，每次登录后运行 `osu-diary start`。打开[网页看板](http://127.0.0.1:24051)，再照常启动 osu!lazer。

已有可用的 tosu（端口 24050）时会直接使用，否则启动自带的 reader，并使用独立配置。当前主要支持 lazer 的 osu!standard 成绩记录与历史导入。看板支持英文与简体中文，安装器和诊断信息使用英文。

如果找不到命令，可以使用安装器打印的完整路径。fish 用户也可运行：

```fish
fish_add_path ~/.local/bin
```

## 语言与统计图表

在页首选择 **English / 简体中文**。首次使用会跟随浏览器首选的英文或中文，否则默认英文；浏览器允许存储时会记住你的选择。切换语言会保留当前页面、筛选条件、图表选项和未保存的设置。

- **每局 pp**：粉色点代表每局成绩，黄色点代表每日最高 pp，位于当地中午。两者共用真实时间轴，没有记录的日期会断开连线；这不是账号总 pp。
- **准确率趋势**：蓝色实线是每日平均，粉色虚线是每日最佳。可选择贴合数据的范围，或固定为完整 0–100%。
- **AR / BPM 分布与表现**：可切换局数和平均准确率。悬停、轻触或聚焦分组，查看边界、局数、已知准确率样本数、平均准确率和最高 pp；点击或按回车/空格查看对应成绩。每组包含下界、不包含上界。
- 默认精度为 0.5 AR / 10 BPM，另有 0.1 AR / 1 BPM 细节选项；窄屏下可横向滚动。
- **节奏与准确率**：每个点是一局，95% 虚线仅供参考，不代表难度门槛。聚焦 pp 或节奏图后，按左右方向键查看成绩，按回车打开谱面。

缺失值仅从对应指标中排除。平均值和分组局数使用所有符合条件的成绩；散点超过 6,000 个时会明确标注抽样，并保留时间覆盖及指标极值。日期分组使用日记服务器的时区，日期和数字按所选语言显示。

## Linux 内存读取权限

Linux 可能阻止 tosu 读取 osu! 内存。安装器会解释原因，在调用 sudo 前征求同意；拒绝不会取消安装。`osu-diary doctor` 可以分别检查 reader 连接和权限设置。

仅在本次开机期间允许读取：

```fish
sudo sysctl -w kernel.yama.ptrace_scope=0
```

该设置允许同一用户的进程检查其他同用户进程；重启后恢复原设置，可能需要再次执行。安装器不会写入永久系统权限配置。reader 显示已连接，也不代表一定能读取当前版本的 osu!。

无人值守安装时可以跳过权限询问：

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | env OSU_DIARY_NONINTERACTIVE=1 bash
```

## 常用命令

```fish
osu-diary start       # 启动日记，使用或启动 tosu
osu-diary open        # 打开看板
osu-diary status      # 成绩数与 reader 连接状态
osu-diary doctor      # 检查运行环境、reader 与权限
osu-diary log         # 查看实时日志
osu-diary stop        # 停止本安装管理的进程
osu-diary restart
osu-diary enable      # 使用 systemd 用户服务设置登录自启
osu-diary disable     # 取消登录自启
osu-diary serve       # 前台运行；tosu 需另行启动
```

## 导入与导出

导入历史前先关闭 osu!lazer。在看板中打开 **设置 → 导入历史成绩**，也可以运行：

```fish
osu-diary import realm
osu-diary import realm /path/to/client.realm
osu-diary import realm --keep PlayerOne,PlayerTwo
osu-diary import pp
osu-diary import csv /path/to/legacy.csv
osu-diary export /path/to/scores.csv
```

Realm 导入保留真实成绩日期，识别主要玩家并跳过重复记录。会从 `storage.ini` 检测自定义存储位置，也支持手动指定 Realm 路径。

旧 CSV 导入接受 `date,ar,bpm,stars,map,mods,acc,miss,notes` 九列格式。导出的 CSV 字段更丰富，不能直接作为备份重新导入。完整备份请先停止日记，再复制 `diary.db` 到安全位置。

**设置 → 在线拉取 pp** 中的 osu! API 凭证是可选项，用于将已提交成绩更新为官方 pp，不影响普通记录功能。本地计算的历史 pp 可能与官方当前算法不同。

**设置 → 用户名筛选** 可以指定记录哪些玩家；自动模式使用实时游戏账号与历史导入识别的身份。

## 文件与配置

| 文件 | 默认位置 |
|---|---|
| 成绩与封面 | `~/.local/share/osu-diary/` |
| 程序 | `~/.local/share/osu-diary/program/` |
| 配置及可选 API 凭证 | `~/.config/osu-diary/config.json` |
| 日志、进程状态及独立 tosu 文件 | `~/.local/state/osu-diary/` |
| 命令 | `~/.local/bin/osu-diary` |

遵循 XDG 目录设置。`OSU_DIARY_CONFIG`、`OSU_DIARY_DATA`、`OSU_DIARY_PORT`、`TOSU_WS` 仅在运行时覆盖配置，不会自动写回配置文件。已有源码目录中存在 `data/diary.db` 时，默认继续使用该数据库。

自定义数据、配置和日志目录应放在程序目录之外；安装器和卸载器会拒绝重叠位置，以保护当前使用的数据。

## 更新与卸载

重新执行安装命令即可更新。下载文件会先校验，启动失败时会恢复上一版程序；保留数据与配置。

```fish
osu-diary uninstall
```

卸载只移除安装器管理的程序和自启配置，保留日记数据、配置与日志。

指定版本安装：

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | env OSU_DIARY_VERSION=v1.1.0 bash
```

可通过 `OSU_DIARY_PREFIX`、`OSU_DIARY_BIN_DIR` 自定义程序和命令位置。不会覆盖已有的非本安装管理的命令或服务。同名 shell 函数可能遮蔽命令，可使用 `~/.local/bin/osu-diary` 直接运行安装后的程序。

## 隐私与排错

成绩保存在本地。封面来自 `assets.ppy.sh`，tosu 可能下载 offsets 或检查更新信息；可选的官方 pp 刷新会访问 osu! API。配置可能包含 API 凭证，请勿公开。

程序仅监听本机回环地址，面向个人本地使用，请勿通过公开代理暴露到互联网。

没有记录到新成绩时，先运行 `osu-diary doctor`，检查 osu!lazer 和 tosu 是否运行，再查看 `osu-diary log`。osu! 更新可能影响 reader 兼容性。历史导入需要兼容的 `client.realm`；实时记录依赖当前 osu! 与 tosu 版本的兼容情况。
