# Backend Module - @nexus-terminal/backend

> [← 返回根文档](../../CLAUDE.md) | **packages/backend**

---

## 变更记录 (Changelog)

### 2025-12-20 22:27:42
- **初始化模块文档**：完成后端模块架构分析与文档建立
- **API 端点索引**：识别 18 个 API 路由模块
- **数据库 Schema**：识别 16 个数据表定义
- **覆盖率**：模块文档初始化完成

---

## 模块概述

**@nexus-terminal/backend** 是星枢终端的核心后端服务，基于 Express.js 构建，提供：
- SSH/SFTP 连接管理与会话挂起
- 用户认证（密码、2FA、Passkey）
- RESTful API 与 WebSocket 实时通信
- 审计日志与通知系统
- Docker 容器管理
- IP 访问控制

---

## 技术栈

| 类别 | 技术/库 |
|------|---------|
| 运行时 | Node.js |
| 框架 | Express 5.x |
| 语言 | TypeScript 5.x |
| 数据库 | SQLite3 |
| SSH 客户端 | ssh2 |
| WebSocket | ws |
| 认证 | bcrypt, speakeasy (2FA), @simplewebauthn/server (Passkey) |
| 会话存储 | session-file-store |
| 国际化 | i18next |

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
│   ├── ssh_keys/                   # SSH 密钥管理
│   ├── transfers/                  # 文件传输
│   ├── path-history/               # 路径历史
│   ├── favorite-paths/             # 收藏路径
│   ├── passkey/                    # Passkey 认证
│   ├── docker/                     # Docker 容器管理
│   ├── user/                       # 用户管理
│   │
│   ├── database/                   # 数据库层
│   │   ├── connection.ts           # SQLite 连接管理
│   │   ├── schema.ts               # 表结构定义
│   │   └── migrations.ts           # 数据库迁移
│   │
│   ├── services/                   # 共享服务
│   │   ├── event.service.ts        # 事件总线
│   │   ├── crypto.service.ts       # 加密服务
│   │   └── ...
│   │
│   ├── websocket/                  # WebSocket 模块
│   │   ├── handlers/               # 消息处理器
│   │   └── ...
│   │
│   ├── config/                     # 配置文件
│   │   └── default-themes.ts       # 预设终端主题
│   │
│   ├── types/                      # TypeScript 类型定义
│   │   ├── connection.types.ts
│   │   ├── settings.types.ts
│   │   └── ...
│   │
│   └── utils/                      # 工具函数
│
├── html-presets/                   # HTML 预设模板
├── Dockerfile                      # Docker 构建配置
├── tsconfig.json                   # TypeScript 配置
└── package.json                    # 包配置
```

---

## API 端点索引

| 路由前缀 | 模块 | 功能描述 |
|---------|------|---------|
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
| `/api/v1/ssh-keys` | ssh_keys | SSH 密钥管理 |
| `/api/v1/transfers` | transfers | 文件传输状态 |
| `/api/v1/path-history` | path-history | 路径浏览历史 |
| `/api/v1/favorite-paths` | favorite-paths | 收藏路径管理 |
| `/api/v1/status` | (内置) | 健康检查 |

---

## 数据库 Schema

### 核心表

| 表名 | 描述 | 关键字段 |
|-----|------|---------|
| `users` | 用户账户 | id, username, hashed_password, two_factor_secret |
| `passkeys` | Passkey 凭证 | id, user_id, credential_id, public_key, counter |
| `connections` | 远程连接配置 | id, name, type, host, port, auth_method, proxy_id, ssh_key_id |
| `ssh_keys` | SSH 私钥存储 | id, name, encrypted_private_key, encrypted_passphrase |
| `proxies` | 代理配置 | id, name, type, host, port, auth_method |
| `tags` | 连接标签 | id, name |
| `connection_tags` | 连接-标签关联 | connection_id, tag_id |

### 功能表

| 表名 | 描述 |
|-----|------|
| `settings` | 系统键值设置 |
| `appearance_settings` | 外观键值设置 |
| `terminal_themes` | 终端颜色主题 |
| `notification_settings` | 通知渠道配置 |
| `audit_logs` | 用户行为审计日志 |
| `command_history` | 执行命令历史 |
| `path_history` | 路径浏览历史 |
| `favorite_paths` | 收藏路径 |
| `quick_commands` | 快捷指令 |
| `quick_command_tags` | 快捷指令标签 |
| `quick_command_tag_associations` | 快捷指令-标签关联 |
| `ip_blacklist` | IP 封禁记录 |

---

## 关键文件清单

### 入口与配置
- `src/index.ts` - 应用入口，Express 初始化与中间件配置
- `src/websocket.ts` - WebSocket 服务初始化
- `src/database/connection.ts` - SQLite 数据库连接管理
- `src/database/schema.ts` - 所有数据表 DDL 定义

### 核心业务
- `src/auth/` - 用户认证全流程（登录、注册、2FA、Passkey、IP 白名单）
- `src/connections/` - SSH/RDP/VNC 连接管理
- `src/sftp/` - SFTP 文件操作
- `src/ssh-suspend/` - SSH 会话挂起与恢复

### 服务层
- `src/services/event.service.ts` - 事件发布订阅
- `src/services/crypto.service.ts` - 数据加解密
- `src/notifications/notification.processor.service.ts` - 通知处理
- `src/notifications/notification.dispatcher.service.ts` - 通知分发

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
|-------|--------|-----|
| `PORT` | 3001 | API 服务端口 |
| `NODE_ENV` | development | 运行环境 |
| `ENCRYPTION_KEY` | (自动生成) | 数据库敏感信息加密密钥 |
| `SESSION_SECRET` | (自动生成) | 会话密钥 |
| `GUACD_HOST` | localhost | Guacamole daemon 地址 |
| `GUACD_PORT` | 4822 | Guacamole daemon 端口 |
| `RP_ID` | - | Passkey 认证的 RP ID |
| `RP_ORIGIN` | - | Passkey 认证的 Origin |

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
5. 在 `src/index.ts` 中注册路由
6. 更新本文档的 API 端点索引

---

## 常见问题 (FAQ)

### Q: 如何添加新的 API 端点？
参照现有模块（如 `tags/`）的结构，创建对应的四层文件，并在 `index.ts` 中注册路由。

### Q: 如何添加新的数据库表？
1. 在 `src/database/schema.ts` 中添加 `createXxxTableSQL`
2. 在 `src/database/connection.ts` 的初始化逻辑中执行该 SQL
3. 如需迁移已有数据，在 `migrations.ts` 中添加迁移脚本

### Q: SSH 连接是如何管理的？
- `connections.service.ts` 负责连接配置的 CRUD
- 实际 SSH 会话通过 WebSocket 建立，处理逻辑在 `src/websocket/` 下
- 会话挂起功能由 `ssh-suspend` 模块管理

---

**文档生成时间**：2025-12-20 22:27:42
