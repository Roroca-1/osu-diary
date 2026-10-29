# osu! 日记（osu-diary）

一个服务搞定 osu! 成绩记录：**自动记录每一局**（含 pp、acc、AR、BPM、mods、miss…和**成绩的真实时间**），网页看板提供日历（每天最高 pp 的图 + 封面）、统计、串速视图。不再需要终端 + HTML + CSV 手动倒腾。

## 工作方式

```
osu!lazer ──内存──▶ tosu (ws://127.0.0.1:24050) ──websocket/v2──▶ osu-diary ──▶ SQLite 日记库
                                                                        │
                                                              http://127.0.0.1:24051（网页看板）
```

- 成绩时间取 tosu 的 `resultsScreen.createdAt`（lazer ScoreInfo.Date），**导入/回看老成绩也会记录成它本来的时间**，不再记成现在。
- 封面优先拉取 `assets.ppy.sh` 官方封面并缓存；断网或未上传谱面回退用本地背景图，再不行显示渐变占位。
- 历史成绩：一次性从 lazer 的 `client.realm` 回填（含 2017 年至今的 legacy 成绩，真实日期），无需手动 CSV。

## Linux 一行安装

```fish
curl -fsSL https://raw.githubusercontent.com/Roroca-1/osu-diary/main/install.sh | bash
```

支持 x86-64、glibc 2.38+ 的现代 Linux（已测试 Ubuntu 24.04、Fedora、Arch）；安装包自带 Node.js、原生依赖与 tosu，无需 Rust/npm/Git。Ubuntu 22.04 因 tosu 系统依赖较新暂不支持，安装器会提前给出说明。Windows、ARM、Alpine 暂不支持。安装器会解释 Linux 内存读取权限，并在需要 sudo 前征求同意；权限调整仅本次开机有效。详细安装、更新、排错与卸载方式见 [English README](README.md)。

## 使用

```fish
osu-diary start      # 启动（后台守护）
osu-diary open       # 打开看板
osu-diary status     # 状态（成绩数 / tosu 连接）
osu-diary enable     # 登录自启（systemd 用户服务，一次设置）
osu-diary log        # 看日志
osu-diary stop       # 停止

# 一次性导入
osu-diary import realm            # 回填 lazer 全部历史成绩（真实日期；重复执行安全）
osu-diary import csv 旧文件.csv    # 导入旧版 osu-reading-log.csv
```

打 osu 前运行 `osu-diary start`；不再依赖个人电脑上的 `osu-train` 或 fish 函数。

## 看板功能

- **日历**：月视图，每天显示当天最高 pp 的那局（封面 + pp + acc + 图名），点开看当天全部成绩，可删除单条
- **谱面页**：点任意成绩跳转到谱面页——该图的全部历史成绩、AR/OD/CS/HP/BPM/星数/长度/mapper 信息、同图集其他难度；`osu://` 游戏内直开
- **统计**：总成绩 / 游玩天数 / 最高 pp / 平均 acc / 总图数；PP 走势、ACC 走势、串速 BPM×ACC 散点、**AR 分布与 BPM 分布（0.1 / 1 精度分箱，悬停看精确值）**、mods 使用
- **成绩**：全部记录列表，点表头升降序排序（时间/AR/BPM/星数/acc/pp/miss），搜索、过滤 mods、最低 pp
- **设置**：
  - **用户名筛选**：看别人 replay 的成绩不会进日记（默认只记录你的游戏账号，可自定义名单）
  - **在线拉取 pp**：填 osu! API v2 的 client_id/secret 后，把已提交成绩的 pp 更新为官方最新算法值
  - 导入历史（realm + 自动 rosu-pp 换算/补 pp）、重算 pp、封面预热/清空、导出 CSV

## 目录与文件

| 路径 | 说明 |
|---|---|
| `~/.local/share/osu-diary/program/` | 程序（Node + rosu-pp，数据自包含） |
| `~/.local/share/osu-diary/diary.db` | 日记数据库（SQLite） |
| `~/.local/share/osu-diary/covers/` | 封面缓存 |
| `~/.config/osu-diary/config.json` | 端口 / tosu 地址 / 数据目录 |
| `~/.config/systemd/user/osu-diary.service` | 自启服务 |
| `~/.local/bin/osu-diary` | 各种 shell 通用命令 |

## 说明

- 历史成绩的 pp：**有 osu! API 凭证时优先在线拉取官方 pp**（按谱面 `/beatmaps/{id}/scores/users/{user}/all` 拉取，再按成绩 id + 时间核对、指纹兜底匹配，防 id 复用）；否则用 rosu-pp 本地重算。导入 realm 时会自动识别本人账号（用户名 + 用户 ID）用于筛选与拉取。
- mods 后等效值：AR/OD/星级/BPM 都会换算（DT 局显示 AR 10.3、BPM ×1.5）。**自定义 DT 倍速**通过 AR 判定窗口反推（tosu 的 rate 字段对 lazer 变速不可靠），非默认倍速显示 `×1.3` 标记。
- 用户名筛选三层兜底：设置里的名单 > tosu 实时 profile > realm 识别账号；设置页可一键清理历史遗留的非本人成绩。
- 数据库按 `scoreId` 或分数指纹去重；服务启动时若检测到历史成绩未换算，会自动补做一次。
- 卸载程序使用 `osu-diary uninstall`，会保留数据库、配置和日志。

## 开发

```fish
node server.mjs                 # 直接跑（默认端口 24051）
node test/mock-tosu2.mjs        # 模拟 tosu 事件流（含历史成绩时间戳场景）
npm run test:ui                # 使用合成数据的隔离 UI 测试
```
