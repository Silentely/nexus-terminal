![banner.png](https://lsky.tuyu.me/i/2025/04/30/681209e053db7.png)

<div align="center">

[![Docker](https://img.shields.io/badge/-Docker-2496ED?style=flat-square&logo=docker&logoColor=white)][docker-url] [![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-4CAF50?style=flat-square)](https://github.com/Silentely/nexus-terminal/blob/main/LICENSE) [![Changelog](https://img.shields.io/badge/changelog-kittylog-10b981)](https://kittylog.app/c/Silentely/nexus-terminal) <br> [中文](./README.md) | [English](./README_EN.md) | [文档](https://nexus.cosr.eu.org) | [更新日志](https://kittylog.app/c/Silentely/nexus-terminal)

[docker-url]: https://ghcr.io/silentely/nexus-terminal-frontend

</div>

## 📖 概述

**星枢终端（Nexus Terminal）** 是一款现代化、功能丰富的 Web SSH / RDP / VNC 客户端，致力于提供高度可定制的远程连接体验。

## 🔀 与上游的不同之处

> 本项目 Fork 自 [Heavrnl/nexus-terminal](https://github.com/Heavrnl/nexus-terminal)。上游对比基线：`Heavrnl/nexus-terminal:main` 在线对比链接：<https://github.com/Heavrnl/nexus-terminal/compare/main...Silentely:main>

以下为本 Fork 相对上游的主要差异（按主题汇总）：

### 🚀 本 Fork 新增

| 类别 | 功能 |
| :-- | :-- |
| **AI 智能助手** | 集成 OpenAI/Claude 多模型，自然语言直接转换为终端命令（NL2CMD），支持 429 重试、结构化输出 |
| **批量命令执行** | 支持多服务器同时执行命令，优先级队列（low/normal/high/urgent），SSH 连接池复用 |
| **数据备份 API** | `/api/v1/backup` 支持导出/导入连接、密钥、标签等 14 类核心数据 |
| **IP 地理定位** | 登录事件自动查询 IP 地理位置，SQLite 持久化缓存 + ASN 支持 + 多提供商适配器 |
| **SSH 跳板路由可视化** | 结构化路由汇总，前端显示跳板路径与延迟 |
| **SSH 批量状态采集** | 合并为单次执行，高延迟场景性能提升 70-85% |
| **命令面板** | `Ctrl + K` 快捷操作检索与执行，支持连接搜索、页面导航、主题切换 |
| **健康检查端点** | `/api/v1/health` 检查 SQLite 连通性、WebSocket 状态、磁盘空间、内存使用 |
| **结构化日志** | pino 引擎驱动，JSON 结构化输出，支持自定义时区、敏感信息脱敏 |
| **Prometheus Metrics** | 内置应用指标采集端点，支持 Grafana 等监控平台对接 |
| **可配置速率限制** | 通过环境变量灵活控制 API 速率限制（含 AI 路由独立限流） |
| **终端外观实时预览** | 外观自定义设置中新增实时预览窗口，支持字体、主题、描边、阴影即时预览 |
| **强制键盘交互式认证** | SSH 连接新增 `keyboard-interactive` 选项，支持 TOTP/2FA 服务器认证 |
| **统一缓存管理器** | 类型安全的 localStorage 操作，支持版本控制与 TTL 过期管理 |
| **统一错误消息提取器** | 消除重复的错误提取模式，全局统一错误处理 |
| **数据导入功能** | 设置页面支持数据导入（配合已有导出功能），支持数据库备份下载 |
| **CDN 边缘部署** | 支持 Cloudflare/CloudFront 等 CDN 加速静态资源分发 |
| **文档站点** | 独立文档站 [nexus.cosr.eu.org](https://nexus.cosr.eu.org)，含部署教程、配置指南、FAQ |

### ⚡ 性能优化

| 优化项 | 效果 |
| :-- | :-- |
| **SSH 终端输入延迟优化** | 输入延迟从 72-232ms 降至 <3ms（**提升 98%**），区分小数据包直写与大数据包批量缓冲 |
| **应用启动性能优化** | 统一初始化 API，3-4 次网络请求合并为 1 次，消除白屏等待 |
| **虚拟滚动统一架构** | 抽取 `useVirtualListSetup` composable，4 个组件统一使用，自动 overscan 缩放 |
| **审计日志行高修复** | 修复 `itemHeight` 与实际行高不匹配导致的内容裁剪，从 100px 调整为 180px |
| **WebWorker 输出处理** | 终端语法高亮移至 Worker 线程，避免大量输出阻塞主线程，含降级兜底 |
| **路由资源预加载** | 认证后自动预加载核心路由 chunk（Dashboard > Workspace > Connections） |
| **Service Worker 增强** | 结构化缓存策略（静态资源/ API / 图标 / 页面），支持离线访问 |
| **前端懒加载优化** | RDP/VNC 组件按需加载，guacamole 依赖 (~200KB) 不再阻塞首屏 |
| **SQLite WAL 模式** | 启用 WAL 模式优化数据库并发读写，减少锁竞争 |
| **审计日志概率清理** | 改为概率触发（每 100 次写入清理一次），避免每次写入都执行清理检查 |
| **数据库索引优化** | 为 proxies/notification_settings/favorite_paths/quick_commands 添加缺失索引 |
| **进程内缓存层** | settings 表 5 分钟 TTL、connections 表 2 分钟 TTL，减少高频 SQL 查询 |
| **SSH 连接池** | 批量任务支持连接复用，每目标最多 3 个空闲连接，60 秒自动回收 |
| **批量任务优先级** | 支持 low/normal/high/urgent 四个优先级，紧急任务优先执行 |
| **WebSocket 多路复用** | 单连接承载多会话，减少浏览器连接数，降低服务器资源消耗 |
| **终端数据压缩** | permessage-deflate 协议压缩 + 16ms 微批处理，降低带宽占用 |

### 🏗️ 架构与部署

| 改进项 | 说明 |
| :-- | :-- |
| **Docker 部署精简** | guacd 内嵌于 remote-gateway 容器，部署从 4 容器精简为 3 容器 |
| **ARM64 开箱即用** | remote-gateway 镜像已内嵌 guacd，无需手动替换 guacd 镜像 |
| **模块化拆分** | SFTP 服务拆分为 readdir/move/copy/path-operations/session 独立执行器；auth 控制器拆分为 login/passkey/2FA/password 动作层 |
| **FileManager 组件拆分** | 从单文件拆分为 composable 组合式函数（排序/过滤、路径导航、列宽调整、布局设置、剪贴板、文件项操作、操作模态框、下载） |
| **Repository 基类抽象** | 统一 Repository 层错误处理与日志记录 |
| **类型化错误体系** | `DatabaseError`、`ValidationError`、`ExternalServiceError` 等类型安全的错误子类 |
| **CSP 安全头** | Content-Security-Policy / X-Frame-Options / X-Content-Type-Options |
| **SSRF / 命令注入 / 路径穿越 / ReDoS 防护** | 完整的安全防御体系 |
| **Docker Compose 生产就绪** | healthcheck、资源限制、restart policy、日志轮转 |
| **镜像仓库** | 使用 GitHub Container Registry（GHCR），命名空间 `ghcr.io/silentely` |

### 📦 上游保留

| 功能       | 说明                                                 |
| :--------- | :--------------------------------------------------- |
| **桌面端** | 上游提供独立的 Electron 桌面客户端，本 Fork 暂未包含 |

---

## ✨ 功能特性

- 多标签页管理 SSH 与 SFTP 连接
- 支持 RDP/VNC 协议
- 支持 PWA
- 采用 Monaco Editor，支持在线编辑文件
- 集成多重登录安全机制，包括人机验证（hCaptcha、Google reCAPTCHA）与双因素认证（2FA）
- 高度可定制的界面主题与布局风格
- 内置简易 Docker 容器管理面板，便于容器运维
- 支持 IP 白名单与黑名单，异常访问自动封禁
- 通知系统（如登录提醒、异常告警）
- 审计日志，全面记录用户行为与系统变更
- 基于 Node.js 的轻量级后端，资源占用低
- 内置心跳保活机制，确保连接稳定
- **批量命令执行**：支持多服务器同时执行命令，实时显示执行进度与结果
- **焦点切换器**：允许在页面上的输入组件之间切换，支持自定义切换顺序和快捷键
- **AI 智能助手**：内置 AI 运维分析，提供系统健康诊断、命令模式分析、安全事件检测
- **数据备份与恢复**：支持导出/导入连接、密钥、标签等 14 类核心数据
- **IP 地理定位**：登录事件自动查询 IP 地理位置，SQLite 持久化缓存，支持多提供商（ip-api/ipinfo）
- **SSH 跳板路由可视化**：结构化路由汇总，前端显示跳板路径与延迟
- **SSH 批量状态采集**：合并为单次执行，高延迟场景性能提升 70-85%

## 📸 截图

|                              终端界面（Light）                              |
| :-------------------------------------------------------------------------: |
| ![workspace_light.png](https://lsky.tuyu.me/i/2025/04/30/68120a8dd0489.png) |

---

|                               终端界面（Dark）                               |
| :--------------------------------------------------------------------------: |
| ![workspace_darker.png](https://lsky.tuyu.me/i/2025/04/30/68120aa275a76.png) |

---

| 移动端界面1 | 移动端界面2 |
| :-: | :-: |
| ![1746339196937.png](https://lsky.tuyu.me/i/2025/05/04/6817056948ac2.png) | ![1746339222136.png](https://lsky.tuyu.me/i/2025/05/04/681705820fe01.png) |

---

## 📚 完整文档

> 部署教程、高级配置、常见问题等详见 **[官方文档](https://nexus.cosr.eu.org)**

## 🚀 快速开始

### 1️⃣ 配置环境

> 建议在 Debian（AMD64 架构）环境中部署，因开发者无 ARM 设备，无法保证其兼容性。

新建文件夹

```bash
mkdir ./nexus-terminal && cd ./nexus-terminal
```

下载仓库中的 [**docker-compose.yml**](https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/docker-compose.yml) 和 [**.env**](https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/.env) 文件到当前目录。

```bash
wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml && wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/.env -O .env
```

> 当前默认镜像仓库为 GitHub Container Registry（GHCR），命名空间：`ghcr.io/silentely`。

> ⚠️ **注意：**
>
> - **arm64 用户**：remote-gateway 镜像已内嵌 guacd，无需额外替换 guacd 镜像。
> - **armv7 用户**请参考下方注意事项。

配置 nginx

```nginx
# WebSocket 连接头映射（放在 http 块中）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书配置（略）

    client_max_body_size 100m;

    # API 请求（不含 WebSocket 升级头，避免干扰普通 HTTP）
    location /api/ {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket（SSH 终端、RDP/VNC 信令等长连接）
    location /ws/ {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    # 前端静态资源 + 兜底
    location / {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> **Docker 部署说明**：`remote-gateway` 容器仅由 `backend` 内部访问（`ws://remote-gateway:8081`），外层 Nginx **无需**单独转发 remote-gateway。RDP/VNC 连接路径为：浏览器 → 外层 Nginx → 前端容器(18111) → 内置 nginx(`/ws/`) → backend(3001) → remote-gateway(8081)。
>
> **HTTPS 部署注意**：WebSocket 信令端点 `/ws/webrtc-signaling` 需要 Origin 校验。如果通过域名访问，请在 `.env` 中设置 `RP_ORIGIN=https://your-domain.com`（代码会自动将其加入 WebSocket Origin 白名单），或显式设置 `ALLOWED_WS_ORIGINS=https://your-domain.com`。

> `SESSION_COOKIE_SECURE` 默认使用 `auto`：HTTP 直连可用于内网学习和首次验证，HTTPS 反向代理会自动下发 Secure Cookie。公网生产环境不要直接暴露明文 HTTP 入口；请通过 HTTPS 反向代理访问，或在 `.env` 中设置 `SESSION_COOKIE_SECURE=true` 强制只允许 HTTPS 会话。

为 docker 配置IPv6（可选，如果你不使用ipv6连接服务器可以不配置）

在`/etc/docker/daemon.json`加入以下内容

```json
{
  "ipv6": true,
  "fixed-cidr-v6": "fd00::/80",
  "ip6tables": true,
  "experimental": true
}
```

重启docker服务

```bash
sudo systemctl restart docker
```

### 2️⃣ 启动服务

```bash
docker compose up -d
```

### 3️⃣ 更新

注意：docker-compose 运行不需要拉取仓库源码，除非你打算自己build，否则只需要在项目目录执行以下命令即可更新。

```bash
docker compose down
```

```bash
docker compose pull
```

```bash
docker compose up -d
```

## 📚 使用指南

### 挂起会话组件

你可以在 SSH 标签页中右键选择“挂起会话”（移动界面长按即可）。一旦挂起，即使网页断开连接，后端也会自动接管并保持 SSH 连接不中断。你可以随时通过面板组件重新恢复会话，整个过程确保编译、长任务等操作不会因网络波动等原因中断。

### 命令输入框组件

1.  **标签页切换**：当命令输入框获得焦点时，使用 `Alt + ↑/↓` 切换 SSH 会话标签页，使用 `Alt + ←/→` 切换文本编辑器标签页。
2.  **命令同步**（需在设置中开启）：开启后，在命令输入框中输入的文字将实时同步到选定的目标输入源。使用 `↑/↓` 键选择菜单命令项，然后按下 `Enter` 发送选中的指令。

### 文件管理器组件

1.  **文件快速选择**：在文件搜索框获得焦点时，可以使用 `↑/↓` 键快速选择文件。
2.  **拖拽上传**：支持从浏览器外部拖拽文件或文件夹进行上传。**注意：** 上传大量文件或深层文件夹时，建议先进行打包压缩，以避免浏览器卡死。
3.  **内部拖拽**：可以直接在文件管理器内部拖动文件或文件夹以进行移动。
4.  **多选操作**：按住 `Ctrl` 或 `Shift` 键可以选择多个文件或文件夹。
5.  **右键菜单**：提供复制、粘贴、剪切、删除、重命名、修改权限等常用文件操作。
6.  **同步终端路径**：点击工具栏“文件夹”按钮可将文件管理器快速切换到当前终端所在目录，后端会基于当前交互 Shell 读取目录并做跨 Shell 兼容回退（`posix`/`fish`/`powershell`/`cmd`）。

### 终端组件

1.  Ctrl + Shift + C 复制，Ctrl + Shift + V 粘贴（需通过 HTTPS 或 localhost 访问，否则浏览器会阻止剪贴板操作）

### 历史命令组件

1.  **查看完整命令**：当历史命令过长被截断时，将鼠标悬停在命令上即可查看完整的指令内容。

### 通用操作

1.  **缩放**：在终端、文件管理器和文本编辑器组件和快捷指令视图中，可以使用 `Ctrl + 鼠标滚轮` 进行缩放。
2.  **侧栏**：展开的侧栏可以通过拖拽调节宽度。
3.  **标签栏**：对于ssh标签栏和文件管理器标签栏可以右键弹出菜单，内容项有：关闭，关闭左侧标签页，关闭其他标签页，关闭右侧标签页。
4.  **标签分组折叠栏** 可以直接点击视图里的标签名字修改标签名称
5.  **自动重连**：在连接断开状态下，可在命令输入框或终端中按回车，或点击连接列表中的同一 SSH 连接以触发自动重连。

### 命令面板

1.  **打开方式**：按下 `Ctrl + K`（macOS 上为 `Cmd + K`）即可打开命令面板，按 `ESC` 或点击遮罩层关闭。
2.  **搜索连接**：在搜索框中输入关键词，可快速筛选已保存的连接并一键跳转至工作区建立连接。
3.  **页面导航**：支持快速跳转到仪表盘、连接管理、系统设置等页面。
4.  **主题切换**：可直接在命令面板中切换深色/浅色主题。
5.  **键盘操作**：使用 `↑` `↓` 方向键浏览选项，按 `Enter` 确认执行。

### 批量命令执行组件

1. **选择服务器**：在批量执行面板中勾选需要执行命令的 SSH 连接，支持全选/取消全选
2. **输入命令**：在命令输入框中输入要执行的命令，支持 sudo 模式
3. **并发控制**：可调整并发数（默认 5），控制同时执行任务的数量
4. **实时进度**：执行过程中显示每个服务器的状态和整体进度
5. **查看输出**：点击"查看"按钮可查看单个服务器的命令输出
6. **取消任务**：执行过程中可随时取消所有未完成的任务

### AI 智能助手组件

1. **快速查询**：点击预设建议可快速查询系统健康、命令模式、安全事件等
2. **自然语言交互**：直接输入问题，AI 助手会分析并返回相关数据
3. **历史会话**：点击历史按钮可查看和恢复之前的会话
4. **智能洞察**：AI 会自动生成可操作的建议，并按严重程度分类显示

### 其他

1. **移动端可以通过双指手势放大缩小终端字体**
2. 如需启用 Passkey 登录，请在 `.env` 文件中设置 `RP_ID` 和 `RP_ORIGIN`。若要“一个 Passkey 跨多个独立域名”，请使用单一 `RP_ID` + 多个 `RP_ORIGIN`，并确保 `/.well-known/webauthn` 可访问。

## 🔧 高级配置

### CORS 跨域配置

如果你需要配置额外的允许域名访问远程桌面网关（Remote Gateway），请参考 [CORS 配置文档](https://nexus.cosr.eu.org/configuration/cors)。

**常见场景**：

- 自定义域名访问
- 多域名支持
- 开发环境配置

**快速配置**：

编辑 `docker-compose.yml` 中的 `remote-gateway` 服务：

```yaml
remote-gateway:
  environment:
    # 添加允许的域名（逗号分隔）
    CORS_ALLOWED_ORIGINS: https://yourdomain.com,https://www.yourdomain.com
```

详细说明请查看 [**CORS 配置完整文档**](https://nexus.cosr.eu.org/configuration/cors)。

## ⚠️ 注意事项

1.  **双文件管理器**：可以在布局中添加两个文件管理器组件（实验性功能，可能存在不稳定情况）。
2.  **多文本编辑器**：在同一布局中添加多个文本编辑器的功能尚未实现。
3.  ARMv7 用户请参考 [部署文档](https://nexus.cosr.eu.org/deployment)。由于 Apache Guacamole 未提供 guacd 的 ARMv7 架构镜像，所以禁用 RDP 功能，相关镜像暂时不再拉取。
4.  数据备份可通过内置 API（`/api/v1/backup`）导出/导入，也可自行备份 `data` 目录。
5.  由于浏览器限制，非https或者localhost无法复制终端内容，请使用https访问

## 💐 致谢

- 预设主题方案来源于优秀的 [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) 项目。

## ☕ 捐赠

如果你觉得这个项目对你有帮助，欢迎通过以下方式请我喝杯咖啡：

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/W7W01GGLJU)

## 人工智能辅助问题分类

该仓库采用了一种由人工智能辅助的问题分类（issue triage）工作流程，具体功能包括：

- 识别可能与部署、反向代理（reverse proxy）、身份验证（auth）或特定协议（protocol）相关的问题；
- 提出具体的故障排除步骤；
- 将问题报告者引导至最相关的文档资料；
- 为可能存在的缺陷制定实施计划。

助手可以提供故障排除步骤，或要求用户提供最少的额外信息。除非维护人员明确要求进行代码修改，否则系统不会自动建议进行代码更改。

## 📄 开源协议

本项目采用 [GPL-3.0](LICENSE) 开源协议，详细信息请参阅 [LICENSE](LICENSE) 文件。
