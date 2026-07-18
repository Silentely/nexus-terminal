# Backend Module - @nexus-terminal/backend

> [← 返回根文档](../../CLAUDE.md) | **packages/backend**

---

## 模块概述

**@nexus-terminal/backend** 是星枢终端的核心后端服务，基于 Express.js 构建，提供：

- SSH/SFTP 连接管理与会话挂起
- 用户认证（密码、2FA、Passkey）
- RESTful API 与 WebSocket 实时通信
- 审计日志与通知系统
- Docker 容器管理
- IP 访问控制
- 仪表盘统计与系统资源监控
- Prometheus 指标暴露

---

## 技术栈

| 类别       | 技术/库                                                   |
| ---------- | --------------------------------------------------------- |
| 运行时     | Node.js                                                   |
| 框架       | Express 5.x                                               |
| 语言       | TypeScript 5.x                                            |
| 数据库     | SQLite3                                                   |
| SSH 客户端 | ssh2                                                      |
| WebSocket  | ws                                                        |
| 认证       | bcrypt, speakeasy (2FA), @simplewebauthn/server (Passkey) |
| 会话存储   | session-file-store                                        |
| 国际化     | i18next                                                   |
| 监控       | prom-client (Prometheus)                                  |
| 日志       | pino + pino-pretty（dev），敏感信息脱敏                   |

---

## 目录结构

```
packages/backend/
├── src/
│   ├── index.ts                    # 应用入口，Express 配置
│   ├── websocket.ts                # WebSocket 服务初始化
│   ├── i18n.ts                     # 国际化配置
│   ├── locales/                    # 多语言资源文件
│   │
│   ├── auth/                       # 用户认证模块
│   │   ├── auth.routes.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.repository.ts
│   │   └── ipWhitelist.middleware.ts
│   │
│   ├── connections/                # SSH/RDP/VNC 连接管理
│   │   ├── connections.routes.ts
│   │   ├── connections.controller.ts
│   │   ├── connections.service.ts
│   │   └── connections.repository.ts
│   │
│   ├── sftp/                       # SFTP 文件操作
│   │   ├── sftp.routes.ts
│   │   ├── sftp.controller.ts
│   │   └── sftp.service.ts
│   │
│   ├── ssh-suspend/                # SSH 会话挂起
│   │   ├── ssh-suspend.routes.ts
│   │   ├── ssh-suspend.controller.ts
│   │   └── ssh-suspend.service.ts
│   │
│   ├── proxies/                    # 代理配置 (SOCKS5/HTTP)
│   ├── tags/                       # 连接标签管理
│   ├── settings/                   # 系统设置
│   ├── notifications/              # 通知系统 (Webhook/Email/Telegram)
│   ├── audit/                      # 审计日志
│   ├── command-history/            # 命令历史
│   ├── quick-commands/             # 快捷指令
│   ├── quick-command-tags/         # 快捷指令标签
│   ├── terminal-themes/            # 终端主题
│   ├── appearance/                 # 外观设置
│   ├── ssh-keys/                   # SSH 密钥管理
│   ├── transfers/                  # 文件传输
│   ├── path-history/               # 路径历史
│   ├── favorite-paths/             # 收藏路径
│   ├── passkey/                    # Passkey 认证
│   ├── docker/                     # Docker 容器管理
│   ├── user/                       # 用户管理
│   │
│   ├── batch/                      # 批量操作模块 (Phase 4)
│   │   ├── batch.types.ts          # 批量任务类型定义
│   │   ├── batch.repository.ts     # 任务数据访问层
│   │   ├── batch.service.ts        # 并发执行逻辑
│   │   ├── batch.controller.ts     # HTTP 请求处理器
│   │   └── batch.routes.ts         # API 路由定义
│   │
│   ├── ai-ops/                     # AI 智能运维模块 (Phase 5)
│   │   ├── ai.types.ts             # AI 会话/消息类型定义
│   │   ├── ai.repository.ts        # 会话数据访问层
│   │   ├── ai.service.ts           # 分析服务逻辑
│   │   ├── ai.controller.ts        # HTTP 请求处理器
│   │   └── ai.routes.ts            # API 路由定义
│   │
│   ├── services/                   # 共享服务
│   │   ├── event.service.ts        # 增强版事件总线（类型安全、错误隔离、中间件链、领域命名空间）
│   │   ├── event.middlewares.ts    # 内置事件中间件（日志记录、事件持久化）
│   │   ├── crypto.service.ts       # 加密服务
│   │   ├── dashboard.service.ts    # 仪表盘统计服务
│   │   ├── dashboard.controller.ts # 仪表盘控制器
│   │   └── dashboard.routes.ts     # 仪表盘 API 路由
│   │
│   ├── metrics/                    # Prometheus 监控模块
│   │   ├── metrics.service.ts      # prom-client 初始化与自定义指标
│   │   ├── metrics.controller.ts   # 指标数据端点
│   │   └── metrics.routes.ts       # 路由定义（受 ENABLE_METRICS 控制）
│   │
│   ├── websocket/                  # WebSocket 模块
│   │   ├── handlers/               # 消息处理器
│   │   └── state.ts                # 客户端连接状态管理
│   │
│   ├── config/                     # 配置文件
│   │   ├── security.config.ts      # 安全配置常量
│   │   ├── default-themes.ts       # 预设终端主题
│   │   ├── env.validator.ts        # 环境变量验证
│   │   ├── app.config.ts           # 应用配置（Passkey RP 等）
│   │   ├── middleware.ts           # 安全中间件（Helmet、CORS、限流、HSTS、Permissions-Policy、COOP、CORP）
│   │   ├── routes.ts               # 集中式路由注册
│   │   └── swagger.config.ts       # OpenAPI/Swagger 配置
│   │
│   ├── logging/                    # 日志模块
│   │   ├── logger.ts               # 日志 re-export 薄包装
│   │   └── redaction.ts            # 敏感信息脱敏（16 正则）
│   │
│   ├── middleware/                  # 中间件
│   │   ├── error.middleware.ts     # 全局错误处理（标准化错误响应）
│   │   ├── log-context.middleware.ts # AsyncLocalStorage 日志上下文传播
│   │   └── request-logger.middleware.ts # 请求级日志中间件
│   │
│   ├── types/                      # TypeScript 类型定义
│   │   ├── connection.types.ts
│   │   ├── settings.types.ts
│   │   ├── error.types.ts          # ErrorCode 枚举与 ErrorResponse
│   │   └── ...
│   │
│   └── utils/                      # 工具函数
│       ├── crypto.ts               # 加密模块（支持密钥轮换）
│       ├── logger.ts               # Pino 日志
│       ├── AppError.ts             # 自定义应用错误类
│       ├── url.ts                  # SSRF 防护（validateUrlNotPrivate）
│       ├── docker-security.ts      # Docker 容器 ID 白名单校验
│       ├── shell-escape.ts         # Shell 命令转义工具
│       └── asyncHandler.ts         # 异步路由处理器包装
│
├── html-presets/                   # HTML 预设模板
├── Dockerfile                      # Docker 构建配置
├── tsconfig.json                   # TypeScript 配置
└── package.json                    # 包配置
```

---

## API 端点索引

| 路由前缀 | 模块 | 功能描述 |
| --- | --- | --- |
| `/api/v1/auth` | auth | 用户登录/注册/登出、2FA、Passkey |
| `/api/v1/connections` | connections | SSH/RDP/VNC 连接 CRUD |
| `/api/v1/sftp` | sftp | 文件上传/下载/列表/删除/权限 |
| `/api/v1/ssh-suspend` | ssh-suspend | 会话挂起与恢复 |
| `/api/v1/proxies` | proxies | 代理配置管理 |
| `/api/v1/tags` | tags | 连接标签 CRUD |
| `/api/v1/settings` | settings | 系统设置读写 |
| `/api/v1/notifications` | notifications | 通知渠道配置 |
| `/api/v1/audit-logs` | audit | 审计日志查询 |
| `/api/v1/command-history` | command-history | 命令历史记录 |
| `/api/v1/quick-commands` | quick-commands | 快捷指令 CRUD |
| `/api/v1/quick-command-tags` | quick-command-tags | 快捷指令标签 |
| `/api/v1/terminal-themes` | terminal-themes | 终端主题配置 |
| `/api/v1/appearance` | appearance | 外观设置 |
| `/api/v1/ssh-keys` | ssh-keys | SSH 密钥管理 |
| `/api/v1/transfers` | transfers | 文件传输状态 |
| `/api/v1/path-history` | path-history | 路径浏览历史 |
| `/api/v1/favorite-paths` | favorite-paths | 收藏路径管理 |
| `/api/v1/passkey` | passkey | Passkey 注册/认证 |
| `/api/v1/batch` | batch | 批量命令执行、任务状态查询、取消/删除 |
| `/api/v1/ai` | ai-ops | AI 会话管理、智能分析查询 |
| `/api/v1/dashboard` | services | 仪表盘统计、时间线、资产健康、系统资源 |
| `/api/v1/metrics` | metrics | Prometheus 指标（受环境变量控制） |
| `/api/v1/backup` | backup | 数据导出/导入/验证 |
| `/api/v1/version` | version | 版本检查代理：`/check` 统一入口（VERSION 优先 + Releases 兜底），兼容 `/latest` `/remote` |
| `/api/v1/health` | (内置) | 健康检查（含 SQLite 连通性检测） |

---

## 数据库 Schema

### 核心表

| 表名 | 描述 | 关键字段 |
| --- | --- | --- |
| `users` | 用户账户 | id, username, hashed_password, two_factor_secret |
| `passkeys` | Passkey 凭证 | id, user_id, credential_id, public_key, counter |
| `connections` | 远程连接配置 | id, name, type, host, port, auth_method, proxy_id, ssh_key_id |
| `ssh_keys` | SSH 私钥存储 | id, name, encrypted_private_key, encrypted_passphrase |
| `proxies` | 代理配置 | id, name, type, host, port, auth_method |
| `tags` | 连接标签 | id, name |
| `connection_tags` | 连接-标签关联 | connection_id, tag_id |

### 功能表

| 表名                             | 描述                      |
| -------------------------------- | ------------------------- |
| `settings`                       | 系统键值设置              |
| `appearance_settings`            | 外观键值设置              |
| `terminal_themes`                | 终端颜色主题              |
| `notification_settings`          | 通知渠道配置              |
| `audit_logs`                     | 用户行为审计日志          |
| `command_history`                | 执行命令历史              |
| `path_history`                   | 路径浏览历史              |
| `favorite_paths`                 | 收藏路径                  |
| `quick_commands`                 | 快捷指令                  |
| `quick_command_tags`             | 快捷指令标签              |
| `quick_command_tag_associations` | 快捷指令-标签关联         |
| `ip_blacklist`                   | IP 封禁记录               |
| `ip_geo_cache`                   | IP 地理定位持久化缓存     |
| `batch_tasks`                    | 批量任务主记录（Phase 4） |
| `batch_subtasks`                 | 批量任务子任务（Phase 4） |
| `ai_sessions`                    | AI 会话记录（Phase 5）    |
| `ai_messages`                    | AI 消息记录（Phase 5）    |

---

## 关键文件清单

### 入口与配置

- `src/index.ts` - 应用入口，Express 初始化与中间件配置
- `src/websocket.ts` - WebSocket 服务初始化
- `src/database/connection.ts` - SQLite 数据库连接管理
- `src/database/schema.ts` - 所有数据表 DDL 定义
- `src/config/security.config.ts` - 安全配置常量（bcrypt轮次、会话超时等）
- `src/config/env.validator.ts` - 环境变量验证与启动检查
- `src/config/app.config.ts` - 应用配置（Passkey RP 等）
- `src/config/middleware.ts` - 安全中间件（Helmet、CORS、限流）
- `src/config/routes.ts` - 集中式路由注册
- `src/config/swagger.config.ts` - OpenAPI/Swagger 文档配置

### 安全与加密

- `src/utils/crypto.ts` - 核心加密模块（支持密钥轮换）
  - `encrypt(text)` / `decrypt(encryptedText)` - AES-256-GCM 加解密
  - `initializeKeyRotation()` - 初始化密钥轮换系统
  - `rotateEncryptionKey(newKeyHex)` - 轮换到新密钥
  - `reEncrypt(encryptedText)` - 使用当前密钥重新加密旧数据
  - `getKeyRotationStatus()` - 获取密钥状态信息
  - `hashPassword(password)` / `comparePassword(password, hash)` - bcrypt 密码哈希
  - `generateSecureRandomString(length)` - 安全随机字符串生成
  - `bufferToBase64url(buffer)` / `base64urlToBuffer(base64urlString)` - WebAuthn 编码工具

### 核心业务

- `src/auth/` - 用户认证全流程（登录、注册、2FA、Passkey、IP 白名单）
- `src/connections/` - SSH/RDP/VNC 连接管理
- `src/sftp/` - SFTP 文件操作
- `src/ssh-suspend/` - SSH 会话挂起与恢复
- `src/batch/` - 批量命令执行（Phase 4）
- `src/ai-ops/` - AI 智能运维分析（Phase 5）

### 服务层

- `src/services/event.service.ts` - 增强版事件总线（50+ 事件类型，支持类型安全、错误隔离、中间件链、领域命名空间、生命周期管理）
- `src/services/event.middlewares.ts` - 内置事件中间件（日志记录、关键事件持久化到 event_logs 表）
- `src/types/event.types.ts` - 事件系统类型定义（EventPayloadMap、EventDomain、PERSISTENT_EVENTS）
- `src/services/crypto.service.ts` - 数据加解密
- `src/services/dashboard.service.ts` - 仪表盘统计（CPU/内存/存储/时间线）
- `src/notifications/notification.processor.service.ts` - 通知处理
- `src/notifications/notification.dispatcher.service.ts` - 通知分发

### 监控与日志

- `src/metrics/metrics.service.ts` - Prometheus 指标采集（HTTP 延迟、WebSocket 连接数、SSH 连接耗时、SFTP 传输字节、认证失败次数、SSH 连接池）
- `src/metrics/metrics.controller.ts` - 指标数据端点
- `src/metrics/metrics.routes.ts` - 路由定义
- `src/middleware/log-context.middleware.ts` - AsyncLocalStorage 日志上下文传播（requestId、userId、protocol 自动注入）
- `src/middleware/request-logger.middleware.ts` - 请求级日志中间件
- `src/logging/logger.ts` - 日志 re-export（脱敏逻辑在 `redaction.ts`）
- `src/logging/redaction.ts` - 敏感信息脱敏（16 正则 + 循环引用检测）
- `src/middleware/error.middleware.ts` - 全局错误处理中间件
- `src/types/error.types.ts` - ErrorCode 枚举与 ErrorResponse 类型
- `src/utils/AppError.ts` - 自定义应用错误类

### 监控文档

- `docs/monitoring/index.md` - 监控与告警配置指南
- `docs/monitoring/grafana-dashboard.json` - Grafana Dashboard 模板（可直接导入）
- `docs/monitoring/alert-rules.yml` - Prometheus 告警规则（认证失败率、SSH 延迟、5xx 错误率等）

---

## 运行命令

```bash
# 开发模式（热重载）
npm run dev

# 构建生产版本
npm run build

# 启动生产服务
npm start
```

---

## 环境变量

| 变量名 | 默认值 | 描述 |
| --- | --- | --- |
| `PORT` | 3001 | API 服务端口 |
| `NODE_ENV` | development | 运行环境 |
| `ENCRYPTION_KEY` | (自动生成) | 数据库敏感信息加密密钥（32字节 hex，支持轮换） |
| `SESSION_SECRET` | (自动生成) | 会话密钥 |
| `GUACD_HOST` | localhost | Guacamole daemon 地址 |
| `GUACD_PORT` | 4822 | Guacamole daemon 端口 |
| `RP_ID` | - | Passkey RP ID。可单值（跨域共享 Passkey 推荐）或多值（按顺序映射） |
| `RP_ORIGIN` | - | Passkey Origin，支持逗号分隔多值（完整 URL） |
| `ENABLE_METRICS` | false | 启用 Prometheus 指标端点（/api/v1/metrics） |
| `ENABLE_GEO_LOOKUP` | true | 启用登录事件 IP 地理位置查询（设为 false 禁用） |
| `GEO_PROVIDER` | ip-api | IP 地理定位提供商：`ip-api`（默认）、`ipinfo` 或 `iplocate` |
| `IPINFO_TOKEN` | - | ipinfo.io API Token（可选，提升请求配额） |
| `IPLOCATE_TOKEN` | - | iplocate.io API Key（可选，提升请求配额与速率限制） |
| `LOG_LEVEL` | info | 运行时日志等级（debug/info/warn/error/silent） |
| `LOG_PRETTY` | - | 日志格式化开关（true=pino-pretty 彩色，false=JSON），dev 模式默认开启 |
| `LOG_REDACT` | true | 日志脱敏开关（false 可关闭敏感信息脱敏） |
| `LOG_TZ` | - | 日志时间戳时区（优先级高于 TZ） |
| `ENABLE_REQUEST_LOG` | true | 启用请求访问日志（false 关闭"请求开始/完成"日志，减少容器日志量） |
| `ENABLE_HSTS` | false | 启用 HSTS 安全头（Strict-Transport-Security），仅生产 HTTPS 环境开启 |

### 安全配置常量（`src/config/security.config.ts`）

| 常量名 | 值 | 描述 |
| --- | --- | --- |
| `CHALLENGE_TIMEOUT` | 5 分钟 | WebAuthn Challenge 超时 |
| `PENDING_AUTH_TIMEOUT` | 5 分钟 | 2FA 临时认证超时 |
| `TEMP_TOKEN_LENGTH` | 32 字节 | 临时令牌长度 |
| `SESSION_COOKIE_MAX_AGE` | 30 天 | Session Cookie 最大存活时间 |
| `BCRYPT_SALT_ROUNDS` | 12 | bcrypt 盐轮次（2025年推荐值：12-14） |
| `ALLOWED_WS_ORIGINS` | localhost:5173等 | WebSocket 允许的 Origin 白名单（逗号分隔，含端口号） |

---

## 分层架构约定

本模块遵循经典的分层架构：

```
routes.ts     → 路由定义与请求分发
controller.ts → 请求解析、参数校验、响应封装
service.ts    → 业务逻辑处理
repository.ts → 数据访问与 SQL 操作
```

### 新增功能的步骤

1. 在 `src/types/` 下定义相关 TypeScript 类型
2. 在 `src/database/schema.ts` 添加表定义（如需）
3. 创建新目录 `src/{feature-name}/`
4. 实现 `*.repository.ts` → `*.service.ts` → `*.controller.ts` → `*.routes.ts`
5. 在 `src/config/routes.ts` 中注册路由
6. 更新本文档的 API 端点索引

---

## 常见问题 (FAQ)

### Q: 如何添加新的 API 端点？

参照现有模块（如 `tags/`）的结构，创建对应的四层文件，并在 `src/config/routes.ts` 中注册路由。

### Q: 如何添加新的数据库表？

1. 在 `src/database/schema.ts` 中添加 `createXxxTableSQL`
2. 在 `src/database/connection.ts` 的初始化逻辑中执行该 SQL
3. 如需迁移已有数据，在 `migrations.ts` 中添加迁移脚本

### Q: SSH 连接是如何管理的？

- `connections.service.ts` 负责连接配置的 CRUD
- 实际 SSH 会话通过 WebSocket 建立，处理逻辑在 `src/websocket/` 下
- 会话挂起功能由 `ssh-suspend` 模块管理

### Q: 如何启用 Prometheus 监控？

设置环境变量 `ENABLE_METRICS=true`，即可通过 `/api/v1/metrics` 端点获取 Prometheus 格式的指标数据。

### Q: 错误处理机制是什么？

- 全局错误处理中间件 `middleware/error.middleware.ts` 捕获所有未处理错误
- 使用 `AppError` 类抛出业务错误，自动映射到 HTTP 状态码
- 敏感信息自动脱敏（`logging/logger.ts` 中的 redact 功能）

---
