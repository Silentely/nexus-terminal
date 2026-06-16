# 功能介绍

Nexus Terminal 覆盖远程服务器管理的核心场景，以下按模块说明各功能。

## 核心连接能力

### SSH 终端

基于 Xterm.js 的高性能终端模拟器，支持完整的 ANSI 颜色、Unicode 字符和 256 色模式。

- **多标签页** — 在单一窗口管理多个 SSH 会话
- **会话挂起** — 网络断开后自动保持连接，随时恢复
- **分屏功能** — 支持水平/垂直分屏，同时查看多个终端
- **快捷键自定义** — 根据个人习惯配置键盘映射

### SFTP 文件管理

图形化文件管理界面，支持上传、下载、重命名、删除等操作。

- **双面板布局** — 本地/远程文件对比视图
- **拖拽上传** — 支持拖拽文件到浏览器上传
- **批量操作** — 支持多选文件批量处理
- **路径收藏** — 常用目录快速访问

### RDP 远程桌面

基于 Guacamole 的 RDP 协议支持，提供完整的 Windows 桌面体验。

- **完整桌面** — 支持 Windows/Linux 远程桌面
- **剪贴板共享** — 本地与远程剪贴板同步
- **文件传输** — 通过 RDP 通道传输文件
- **多显示器** — 支持多屏幕环境

### VNC 远程桌面

跨平台的 VNC 协议支持，连接 Linux/Unix 图形界面。

- **跨平台** — 支持 Linux、Unix、macOS 图形桌面
- **自适应分辨率** — 根据浏览器窗口自动调整
- **鼠标同步** — 精确的鼠标指针同步

## 智能功能

### AI 智能助手

集成 AI 能力，提供系统分析、命令建议、故障排查。

- **快速查询** — 预设建议快速获取系统状态
- **自然语言交互** — 用自然语言描述需求，AI 生成命令
- **智能洞察** — 自动分析系统状态，提供优化建议
- **历史会话** — 保存对话历史，随时回顾

### 批量命令执行

同时在多台服务器执行相同命令，提升运维效率。

- **多目标执行** — 同时向多台服务器发送命令
- **并行/串行** — 支持并行或按顺序执行
- **结果聚合** — 汇总所有服务器的执行结果
- **模板保存** — 常用命令模板快速调用

### 快速命令

预设常用命令，一键执行，减少重复输入。

- **标签分类** — 按功能分类管理命令
- **变量支持** — 命令支持参数占位符
- **快捷键** — 为常用命令设置快捷键
- **历史记录** — 记录执行历史，快速复用

## 安全特性

### 多因素认证

- **密码认证** — 传统的用户名/密码登录
- **TOTP 两步验证** — 支持 Google Authenticator 等 TOTP 应用
- **Passkey** — 无密码认证，支持 WebAuthn 标准
- **IP 白名单** — 限制可访问的 IP 地址

### 审计日志

- **操作记录** — 记录登录、连接、命令执行等操作
- **查询过滤** — 按时间、用户、操作类型筛选
- **导出功能** — 支持导出审计日志
- **实时通知** — 敏感操作实时推送通知

### 数据加密

- **传输加密** — SSH/RDP/VNC 通道加密
- **存储加密** — 数据库敏感字段 AES-256 加密存储
- **密钥管理** — 自动生成和管理加密密钥

## 通知系统

支持 Webhook、Email、Telegram 多种通知渠道，以下事件均可触发通知推送：

### 认证事件

| 事件                   | 说明             |
| ---------------------- | ---------------- |
| `LOGIN_SUCCESS`        | 登录成功         |
| `LOGIN_FAILURE`        | 登录失败         |
| `LOGOUT`               | 用户登出         |
| `PASSWORD_CHANGED`     | 密码已更改       |
| `2FA_ENABLED`          | 两步验证已启用   |
| `2FA_DISABLED`         | 两步验证已禁用   |
| `PASSKEY_REGISTERED`   | 通行密钥已注册   |
| `PASSKEY_AUTH_SUCCESS` | 通行密钥认证成功 |
| `PASSKEY_AUTH_FAILURE` | 通行密钥认证失败 |
| `PASSKEY_DELETED`      | 通行密钥已删除   |

### 连接与配置事件

| 事件                   | 说明            |
| ---------------------- | --------------- |
| `CONNECTION_CREATED`   | 连接已创建      |
| `CONNECTION_UPDATED`   | 连接已更新      |
| `CONNECTION_DELETED`   | 连接已删除      |
| `PROXY_CREATED`        | 代理已创建      |
| `PROXY_UPDATED`        | 代理已更新      |
| `PROXY_DELETED`        | 代理已删除      |
| `TAG_CREATED`          | 标签已创建      |
| `TAG_UPDATED`          | 标签已更新      |
| `TAG_DELETED`          | 标签已删除      |
| `SETTINGS_UPDATED`     | 设置已更新      |
| `IP_WHITELIST_UPDATED` | IP 白名单已更新 |

### SSH 会话事件

| 事件                    | 说明               |
| ----------------------- | ------------------ |
| `SSH_CONNECT_SUCCESS`   | SSH 连接成功       |
| `SSH_CONNECT_FAILURE`   | SSH 连接失败       |
| `SSH_SHELL_FAILURE`     | SSH Shell 打开失败 |
| `SSH_DISCONNECT`        | SSH 连接已断开     |
| `SSH_SESSION_SUSPENDED` | SSH 会话已挂起     |

### 批量任务事件

| 事件                   | 说明           |
| ---------------------- | -------------- |
| `BATCH_TASK_CREATED`   | 批量任务已创建 |
| `BATCH_TASK_COMPLETED` | 批量任务已完成 |
| `BATCH_TASK_FAILED`    | 批量任务失败   |
| `BATCH_TASK_CANCELLED` | 批量任务已取消 |

### 备份事件

| 事件                      | 说明         |
| ------------------------- | ------------ |
| `BACKUP_EXPORT_COMPLETED` | 备份导出完成 |
| `BACKUP_EXPORT_FAILED`    | 备份导出失败 |
| `BACKUP_IMPORT_COMPLETED` | 备份导入完成 |
| `BACKUP_IMPORT_FAILED`    | 备份导入失败 |

### Docker 事件

| 事件                              | 说明                |
| --------------------------------- | ------------------- |
| `DOCKER_CONTAINER_STARTED`        | Docker 容器已启动   |
| `DOCKER_CONTAINER_STOPPED`        | Docker 容器已停止   |
| `DOCKER_CONTAINER_REMOVED`        | Docker 容器已移除   |
| `DOCKER_CONTAINER_COMMAND_FAILED` | Docker 容器操作失败 |

### SFTP 事件

| 事件                   | 说明          |
| ---------------------- | ------------- |
| `SFTP_CONNECT_SUCCESS` | SFTP 连接成功 |
| `SFTP_CONNECT_FAILURE` | SFTP 连接失败 |

### 系统事件

| 事件                   | 说明         |
| ---------------------- | ------------ |
| `DATABASE_MIGRATION`   | 数据库迁移   |
| `ADMIN_SETUP_COMPLETE` | 初始设置完成 |

## 系统监控

### 仪表盘

实时监控 CPU 使用率、内存使用、磁盘状态、网络流量。

### Prometheus 指标

暴露以下指标（通过 `/api/v1/metrics` 端点）：

| 指标名称                        | 类型      | 说明                                            |
| ------------------------------- | --------- | ----------------------------------------------- |
| `http_request_duration_seconds` | Histogram | HTTP 请求延迟分布                               |
| `websocket_active_connections`  | Gauge     | 当前活跃 WebSocket 连接数                       |
| `ssh_active_sessions`           | Gauge     | 当前活跃 SSH 会话数                             |
| `ssh_connect_duration_seconds`  | Histogram | SSH 连接建立耗时（status: success/failure）     |
| `ssh_pool_connections`          | Gauge     | SSH 连接池连接数                                |
| `sftp_transferred_bytes_total`  | Counter   | SFTP 传输总字节数（direction: upload/download） |
| `auth_failures_total`           | Counter   | 认证失败次数（method: password/passkey/2fa）    |

[监控与告警指南](./monitoring/index.md)包含配置详情、Grafana Dashboard 模板和告警规则。

## 性能优化

### 虚拟滚动

统一的虚拟列表架构，支持大数据量场景下的流畅渲染。

- **通用 Composable** — `useVirtualListSetup` 封装 `@vueuse/core`，消除重复样板代码
- **自动 overscan 缩放** — 根据行高动态调整预渲染数量，平衡流畅度与渲染开销
- **文件管理器** — 海量文件列表（1000+）流畅滚动，支持动态行高
- **命令历史** — 数千条记录无卡顿渲染，键盘导航兼容
- **审计日志** — 大 JSON 详情块不裁剪，行高自动适配
- **连接列表** — 超过 50 个连接时自动启用，条件激活

### WebWorker 线程

将计算密集型任务移至 Worker 线程，避免阻塞主线程。

- **终端输出处理** — 语法高亮（JSON/YAML/LOG/TABLE）在 Worker 中执行
- **通用 Worker 池** — `createWorkerPool` 管理多 Worker 并行任务
- **主线程降级** — Worker 不可用时自动回退到同步处理
- **Promise API** — 基于 ID 的请求/响应关联，支持超时控制

### 路由预加载

认证后自动预加载核心路由 chunk，减少页面切换加载时间。

- **智能调度** — 使用 `requestIdleCallback` 在浏览器空闲时执行
- **优先级控制** — Dashboard > Workspace > Connections 按序预加载
- **认证触发** — 仅登录用户触发，避免未认证用户浪费带宽

### Service Worker

结构化缓存策略，支持离线访问核心功能。

- **多缓存桶** — 静态资源（Cache-First）、API（Network-First）、图标（Cache-First）、页面（Network-First）
- **离线降级** — 导航请求失败时返回缓存的 `index.html`
- **API 缓存** — 10 秒超时降级，最多缓存 50 条响应，FIFO 淘汰
- **版本管理** — 缓存名包含版本号，新版本自动清理旧缓存

### WebSocket 多路复用

单个物理 WebSocket 连接承载多个逻辑 SSH 会话，减少浏览器连接数和服务器资源消耗。

- **sid 路由** — 消息中携带 Session ID 字段实现多会话复用，向后兼容传统模式
- **环境变量控制** — `ENABLE_MULTIPLEX=true` 启用，默认关闭，两种模式共存
- **物理连接重连** — 断开时自动重连，重连后重建所有活跃通道
- **通道隔离** — 每个逻辑通道独立维护连接状态和消息处理

### 终端数据压缩

两层压缩机制降低带宽占用，提升高流量场景下的传输效率。

- **permessage-deflate** — WebSocket 协议层压缩，level=3 低 CPU 开销，threshold=256 跳过小消息
- **SSH 输出微批处理** — 16ms 窗口合并多个小数据块为单帧，减少帧数并提升压缩比
- **浏览器自动协商** — 无需前端改动，支持压缩的浏览器自动启用

### CDN 边缘部署

支持 Cloudflare、CloudFront 等 CDN 服务加速静态资源分发。

- **缓存规则** — `/assets/*` 长期缓存，`/index.html` 绕过缓存
- **WebSocket 直通** — `/ws/*` 路径绕过 CDN 缓存，直接代理到后端
- **Brotli 压缩** — 支持 Brotli 预压缩资源，进一步降低传输体积

## 用户体验

### 个性化定制

- **主题库** — 内置 100+ iTerm2 配色方案
- **布局自定义** — 拖拽调整组件布局
- **字体设置** — 自定义字体和字号
- **背景动效** — 终端背景动画效果

### 移动端适配

- **触控优化** — 手势操作支持
- **自适应布局** — 根据屏幕自动调整（横竖屏自适应虚拟键盘）
- **字体缩放** — 双指手势调整终端字体
- **键盘避让** — VisualViewport API 检测虚拟键盘弹出，动态调整终端高度
- **PWA 支持** — 可安装为本地应用，支持离线访问和快捷方式

### 快捷键

- `Ctrl+T` — 新建标签
- `Ctrl+W` — 关闭标签
- `Ctrl+Tab` — 切换标签
- `Ctrl+Shift+E` — 水平分屏

## 对比优势

### 与同类工具对比

| 特性            | Nexus Terminal   | Apache Guacamole  | Nexterm     | Termix | ShellNGN |
| --------------- | ---------------- | ----------------- | ----------- | ------ | -------- |
| **协议支持**    | SSH/SFTP/RDP/VNC | RDP/VNC/SSH       | SSH/RDP/VNC | SSH    | SSH      |
| **部署方式**    | Docker 一键      | 需 Guacd + 数据库 | Docker      | Docker | 云托管   |
| **会话挂起**    | 支持             | 不支持            | 不支持      | 不支持 | 不支持   |
| **AI 智能助手** | 内置             | 无                | 无          | 无     | 无       |
| **批量命令**    | 支持             | 无                | 无          | 无     | 无       |
| **2FA/TOTP**    | 支持             | 需外部集成        | 无          | 无     | 无       |
| **Passkey**     | 支持             | 无                | 无          | 无     | 无       |
| **审计日志**    | 完整支持         | 基础日志          | 无          | 无     | 无       |
| **移动端适配**  | 完整支持         | 有限              | 有限        | 有限   | 支持     |
| **开源协议**    | GPL-3.0          | Apache 2.0        | MIT         | MIT    | 商业     |
| **中文支持**    | 原生中文         | 需翻译            | 无          | 无     | 无       |

### 与传统 SSH 客户端对比

| 特性     | Nexus Terminal | PuTTY / Xshell | Termius      |
| -------- | -------------- | -------------- | ------------ |
| 多协议   | SSH/RDP/VNC    | 仅 SSH         | SSH/RDP      |
| 部署方式 | Docker 一键    | 需安装客户端   | 需安装客户端 |
| 移动端   | 完整支持       | 不支持         | 支持         |
| 会话挂起 | 支持           | 部分支持       | 支持         |
| 审计日志 | 完整支持       | 不支持         | 部分支持     |
| AI 助手  | 内置           | 无             | 无           |
| 批量执行 | 支持           | 不支持         | 部分支持     |
| 团队协作 | 审计 + 通知    | 无             | 部分支持     |
| 价格     | 免费开源       | 免费/付费      | 订阅制       |
