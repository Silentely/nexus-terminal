# 星枢终端变量文档 (VARIABLES.md)

> 本文档整理星枢终端项目中涉及的所有变量，包括环境变量、配置常量、类型定义等。

---

## 目录

- [1. 后端环境变量](#1-后端环境变量)
- [2. Remote Gateway 环境变量](#2-remote-gateway-环境变量)
- [3. Docker Compose 变量](#3-docker-compose-变量)
- [4. 安全配置常量](#4-安全配置常量)
- [5. 速率限制配置](#5-速率限制配置)
- [6. API 客户端常量](#6-api-客户端常量)
- [7. 前端状态管理变量](#7-前端状态管理变量)
- [8. 前端设置变量](#8-前端设置变量)
- [9. 数据库配置](#9-数据库配置)

---

## 1. 后端环境变量

> 定义位置：`packages/backend/src/config/env.validator.ts`

### 1.1 核心配置

| 变量名            | 类型                                      | 必填 | 默认值           | 描述                   |
| ----------------- | ----------------------------------------- | ---- | ---------------- | ---------------------- |
| `NODE_ENV`        | `'development' \| 'production' \| 'test'` | 否   | `development`    | 运行环境               |
| `PORT`            | `number`                                  | 否   | `3001`           | API 服务端口 (1-65535) |
| `APP_NAME`        | `string`                                  | 否   | `Nexus Terminal` | 应用名称               |
| `DEPLOYMENT_MODE` | `'local' \| 'docker'`                     | 否   | `local`          | 部署模式               |

### 1.2 加密与会话

| 变量名           | 类型     | 必填   | 默认值     | 描述                                        |
| ---------------- | -------- | ------ | ---------- | ------------------------------------------- |
| `ENCRYPTION_KEY` | `string` | **是** | (自动生成) | 数据库敏感信息加密密钥 (64字符 hex, 32字节) |
| `SESSION_SECRET` | `string` | **是** | (自动生成) | 会话密钥 (128字符 hex, 64字节)              |

> **注意**: `ENCRYPTION_KEY` 和 `SESSION_SECRET` 在首次启动时自动生成并写入数据目录下的 `.env`
>
> - 本地运行（仓库内）：`packages/backend/data/.env`
> - Docker Compose 部署：挂载卷 `./data/.env`（容器内为 `/app/data/.env`）

### 1.3 Guacamole 配置

| 变量名       | 类型     | 必填 | 默认值      | 描述                            |
| ------------ | -------- | ---- | ----------- | ------------------------------- |
| `GUACD_HOST` | `string` | 否   | `localhost` | Guacamole daemon 地址           |
| `GUACD_PORT` | `number` | 否   | `4822`      | Guacamole daemon 端口 (1-65535) |

### 1.4 远程网关配置

| 变量名                           | 类型     | 必填 | 默认值                       | 描述                                 |
| -------------------------------- | -------- | ---- | ---------------------------- | ------------------------------------ |
| `REMOTE_GATEWAY_API_BASE_LOCAL`  | `string` | 否   | `http://localhost:9090`      | 本地开发时远程网关 API 地址          |
| `REMOTE_GATEWAY_API_BASE_DOCKER` | `string` | 否   | `http://remote-gateway:9090` | Docker 部署时远程网关 API 地址       |
| `REMOTE_GATEWAY_WS_URL_LOCAL`    | `string` | 否   | `ws://localhost:8080`        | 本地开发时远程网关 WebSocket 地址    |
| `REMOTE_GATEWAY_WS_URL_DOCKER`   | `string` | 否   | `ws://remote-gateway:8080`   | Docker 部署时远程网关 WebSocket 地址 |

### 1.5 Passkey 配置

| 变量名      | 类型     | 必填 | 默认值                  | 描述                                             |
| ----------- | -------- | ---- | ----------------------- | ------------------------------------------------ |
| `RP_ID`     | `string` | 否   | `localhost`             | WebAuthn Relying Party ID (必须匹配生产环境域名) |
| `RP_ORIGIN` | `string` | 否   | `http://localhost:5173` | WebAuthn Relying Party Origin (必须匹配前端地址) |

### 1.6 跨域配置

| 变量名            | 类型     | 必填 | 默认值 | 描述                              |
| ----------------- | -------- | ---- | ------ | --------------------------------- |
| `ALLOWED_ORIGINS` | `string` | 否   | -      | 允许的跨域来源 (逗号分隔多个域名) |

### 1.7 WebSocket 心跳配置

| 变量名                       | 类型     | 必填 | 默认值  | 描述                   |
| ---------------------------- | -------- | ---- | ------- | ---------------------- |
| `HEARTBEAT_INTERVAL_DESKTOP` | `number` | 否   | `30000` | 桌面端心跳间隔 (毫秒)  |
| `HEARTBEAT_INTERVAL_MOBILE`  | `number` | 否   | `12000` | 移动端心跳间隔 (毫秒)  |
| `MAX_MISSED_PONGS_DESKTOP`   | `number` | 否   | `1`     | 桌面端最大容忍丢包次数 |
| `MAX_MISSED_PONGS_MOBILE`    | `number` | 否   | `3`     | 移动端最大容忍丢包次数 |

### 1.8 AI/NL2CMD 调试

> 定义位置：`packages/backend/src/config/env.validator.ts`（校验）  
> 使用位置：`packages/backend/src/ai-ops/nl2cmd.service.ts`、`packages/backend/src/ai-ops/nl2cmd.controller.ts`

| 变量名                     | 类型         | 必填 | 默认值 | 描述                                                                         |
| -------------------------- | ------------ | ---- | ------ | ---------------------------------------------------------------------------- |
| `NL2CMD_TIMING_LOG`        | `'0' \| '1'` | 否   | `0`    | 是否强制输出 NL2CMD 分段耗时日志（`1`=开启）。开发环境会自动输出慢请求日志。 |
| `NL2CMD_SLOW_THRESHOLD_MS` | `number`     | 否   | `3000` | 慢请求阈值（毫秒）。当总耗时 ≥ 阈值时输出耗时日志。                          |

> 相关输出：后端会输出以 `[NL2CMD Timing]` / `[NL2CMD HTTP]` 开头的日志，并在 `/api/v1/ai/nl2cmd` 与 `/api/v1/ai/test` 响应头中返回 `x-request-id` 以便串联前后端排查。

---

## 2. Remote Gateway 环境变量

> 定义位置：`packages/remote-gateway/src/server.ts`

| 变量名                    | 类型      | 必填 | 默认值                  | 描述                              |
| ------------------------- | --------- | ---- | ----------------------- | --------------------------------- |
| `REMOTE_GATEWAY_WS_PORT`  | `number`  | 否   | `8080`                  | Guacamole WebSocket 端口          |
| `REMOTE_GATEWAY_API_PORT` | `number`  | 否   | `9090`                  | API 服务端口                      |
| `GUACD_HOST`              | `string`  | 否   | `localhost`             | Guacd 服务地址                    |
| `GUACD_PORT`              | `number`  | 否   | `4822`                  | Guacd 服务端口                    |
| `FRONTEND_URL`            | `string`  | 否   | `http://localhost:5173` | 前端 URL (CORS 白名单)            |
| `MAIN_BACKEND_URL`        | `string`  | 否   | `http://localhost:3000` | 后端 URL (CORS 白名单)            |
| `NODE_ENV`                | `string`  | 否   | -                       | 运行环境                          |
| `CORS_ALLOWED_ORIGINS`    | `string`  | 否   | -                       | CORS 允许的来源 (逗号分隔)        |
| `CORS_ALLOW_ALL`          | `boolean` | 否   | `false`                 | 是否允许所有来源 (生产环境不推荐) |

---

## 3. Docker Compose 变量

> 定义位置：`docker-compose.yml`

### Frontend 服务

| 变量/配置 | 值                                       | 描述                         |
| --------- | ---------------------------------------- | ---------------------------- |
| 镜像      | `heavrnl/nexus-terminal-frontend:latest` | 前端容器镜像                 |
| 端口映射  | `18111:80`                               | 外部端口 18111 映射到容器 80 |

### Backend 服务

| 变量/配置  | 值                                      | 描述         |
| ---------- | --------------------------------------- | ------------ |
| 镜像       | `heavrnl/nexus-terminal-backend:latest` | 后端容器镜像 |
| `NODE_ENV` | `production`                            | 生产环境模式 |
| `PORT`     | `3001`                                  | 服务端口     |
| 数据卷     | `./data:/app/data`                      | 挂载数据目录 |

### Remote Gateway 服务

| 变量/配置                 | 值                                             | 描述                |
| ------------------------- | ---------------------------------------------- | ------------------- |
| 镜像                      | `heavrnl/nexus-terminal-remote-gateway:latest` | 远程网关容器镜像    |
| `GUACD_HOST`              | `guacd`                                        | 连接内部 guacd 服务 |
| `GUACD_PORT`              | `4822`                                         | Guacd 端口          |
| `REMOTE_GATEWAY_API_PORT` | `9090`                                         | API 端口            |
| `REMOTE_GATEWAY_WS_PORT`  | `8080`                                         | WebSocket 端口      |
| `FRONTEND_URL`            | `http://frontend`                              | 前端地址            |
| `MAIN_BACKEND_URL`        | `http://backend:3001`                          | 后端地址            |

### Guacd 服务

| 变量/配置 | 值                       | 描述                  |
| --------- | ------------------------ | --------------------- |
| 镜像      | `guacamole/guacd:latest` | Guacamole daemon 镜像 |
| 重启策略  | `unless-stopped`         | 异常退出自动重启      |

---

## 4. 安全配置常量

> 定义位置：`packages/backend/src/config/security.config.ts`

| 常量名                   | 值                                | 描述                           |
| ------------------------ | --------------------------------- | ------------------------------ |
| `CHALLENGE_TIMEOUT`      | `5 * 60 * 1000` (5分钟)           | WebAuthn Challenge 超时时间    |
| `PENDING_AUTH_TIMEOUT`   | `5 * 60 * 1000` (5分钟)           | 2FA 临时认证超时时间           |
| `TEMP_TOKEN_LENGTH`      | `32`                              | 临时令牌长度 (字节)            |
| `SESSION_COOKIE_MAX_AGE` | `30 * 24 * 60 * 60 * 1000` (30天) | Session Cookie 最大存活时间    |
| `BCRYPT_SALT_ROUNDS`     | `12`                              | bcrypt 盐轮次 (2025年推荐值)   |
| `ALLOWED_WS_ORIGINS`     | 动态计算                          | WebSocket 允许的 Origin 白名单 |

---

## 5. 速率限制配置

> 定义位置：`packages/backend/src/config/rate-limit.config.ts`

### 严格限流器 (登录相关)

| 配置项     | 值                                             | 描述         |
| ---------- | ---------------------------------------------- | ------------ |
| `windowMs` | `15 * 60 * 1000`                               | 15分钟窗口   |
| `max`      | `5`                                            | 最多5次尝试  |
| 适用端点   | `/login`, `/login/2fa`, `/passkey/*`, `/setup` | 防止暴力破解 |

### 中等限流器 (认证选项)

| 配置项     | 值                                                                 | 描述         |
| ---------- | ------------------------------------------------------------------ | ------------ |
| `windowMs` | `15 * 60 * 1000`                                                   | 15分钟窗口   |
| `max`      | `30`                                                               | 最多30次请求 |
| 适用端点   | `/passkey/authentication-options`, `/passkey/registration-options` | 认证选项生成 |

### 宽松限流器 (一般 API)

| 配置项     | 值                           | 描述          |
| ---------- | ---------------------------- | ------------- |
| `windowMs` | `15 * 60 * 1000`             | 15分钟窗口    |
| `max`      | `100`                        | 最多100次请求 |
| 适用端点   | 只读配置查询、认证状态检查等 | 一般 API 端点 |

### AI/NL2CMD 限流器

| 配置项     | 值                                     | 描述                     |
| ---------- | -------------------------------------- | ------------------------ |
| `windowMs` | `60 * 1000`                            | 1分钟窗口                |
| `max`      | `10`                                   | 最多10次请求             |
| 适用端点   | `/api/v1/ai/nl2cmd`, `/api/v1/ai/test` | 防止 AI API 配额快速耗尽 |

---

## 6. API 客户端常量

> 定义位置：`packages/frontend/src/utils/apiClient.ts`

| 常量名                       | 值        | 描述                |
| ---------------------------- | --------- | ------------------- |
| `DEFAULT_REQUEST_TIMEOUT_MS` | `10_000`  | 默认请求超时 (10秒) |
| `AI_REQUEST_TIMEOUT_MS`      | `60_000`  | AI 请求超时 (60秒)  |
| `baseURL`                    | `/api/v1` | API 基础路径        |

---

## 7. 前端状态管理变量

### 7.1 Auth Store (`auth.store.ts`)

| 状态变量               | 类型                          | 初始值                      | 描述               |
| ---------------------- | ----------------------------- | --------------------------- | ------------------ |
| `isAuthenticated`      | `boolean`                     | `false`                     | 是否已登录         |
| `user`                 | `UserInfo \| null`            | `null`                      | 当前用户信息       |
| `isLoading`            | `boolean`                     | `false`                     | 加载状态           |
| `error`                | `string \| null`              | `null`                      | 错误信息           |
| `loginRequires2FA`     | `boolean`                     | `false`                     | 是否需要 2FA       |
| `tempToken`            | `string \| null`              | `null`                      | 2FA 临时令牌       |
| `ipBlacklist`          | `IpBlacklistState`            | `{ entries: [], total: 0 }` | IP 黑名单          |
| `needsSetup`           | `boolean`                     | `false`                     | 是否需要初始设置   |
| `publicCaptchaConfig`  | `PublicCaptchaConfig \| null` | `null`                      | 公开 CAPTCHA 配置  |
| `passkeys`             | `PasskeyInfo[] \| null`       | `null`                      | Passkey 列表       |
| `passkeysLoading`      | `boolean`                     | `false`                     | Passkey 加载状态   |
| `hasPasskeysAvailable` | `boolean`                     | `false`                     | 是否有可用 Passkey |

### 7.2 Connections Store (`connections.store.ts`)

| 状态变量      | 类型               | 初始值  | 描述     |
| ------------- | ------------------ | ------- | -------- |
| `connections` | `ConnectionInfo[]` | `[]`    | 连接列表 |
| `isLoading`   | `boolean`          | `false` | 加载状态 |
| `error`       | `string \| null`   | `null`  | 错误信息 |

### 7.3 AI Store (`ai.store.ts`)

| 状态变量           | 类型                                            | 初始值  | 描述         |
| ------------------ | ----------------------------------------------- | ------- | ------------ |
| `currentSessionId` | `string \| null`                                | `null`  | 当前会话 ID  |
| `messages`         | `AIMessage[]`                                   | `[]`    | 消息列表     |
| `sessions`         | `AISession[]`                                   | `[]`    | 会话列表     |
| `isLoading`        | `boolean`                                       | `false` | 加载状态     |
| `isTyping`         | `boolean`                                       | `false` | AI 正在输入  |
| `error`            | `string \| null`                                | `null`  | 错误信息     |
| `insights`         | `AIInsight[]`                                   | `[]`    | 洞察列表     |
| `suggestions`      | `string[]`                                      | `[]`    | 建议列表     |
| `healthSummary`    | `AIHealthSummaryResponse['summary'] \| null`    | `null`  | 系统健康摘要 |
| `commandPatterns`  | `AICommandPatternsResponse['analysis'] \| null` | `null`  | 命令模式分析 |

### 7.4 Session Store (`session/state.ts`)

| 状态变量            | 类型                        | 初始值      | 描述               |
| ------------------- | --------------------------- | ----------- | ------------------ |
| `sessions`          | `Map<string, SessionState>` | `new Map()` | 会话 Map           |
| `activeSessionId`   | `string \| null`            | `null`      | 当前活动会话 ID    |
| `isRdpModalOpen`    | `boolean`                   | `false`     | RDP 模态框是否打开 |
| `rdpConnectionInfo` | `ConnectionInfo \| null`    | `null`      | RDP 连接信息       |

### 7.5 Layout Store (`layout.store.ts`)

| 状态变量           | 类型                                      | 初始值         | 描述             |
| ------------------ | ----------------------------------------- | -------------- | ---------------- |
| `layoutTree`       | `LayoutNode \| null`                      | `null`         | 布局树结构       |
| `sidebarPanes`     | `{ left: PaneName[]; right: PaneName[] }` | 默认侧边栏面板 | 侧边栏面板配置   |
| `allPossiblePanes` | `PaneName[]`                              | 所有可用面板   | 所有面板名称列表 |
| `isLayoutVisible`  | `boolean`                                 | `true`         | 整体布局可见性   |
| `isHeaderVisible`  | `boolean`                                 | `true`         | 主导航栏可见性   |

### 7.6 Appearance Store (`appearance.store.ts`)

| 状态变量                    | 类型                                                  | 初始值  | 描述              |
| --------------------------- | ----------------------------------------------------- | ------- | ----------------- |
| `isStyleCustomizerVisible`  | `boolean`                                             | `false` | 样式编辑器可见性  |
| `appearanceSettings`        | `Partial<AppearanceSettings>`                         | `{}`    | 外观设置          |
| `allTerminalThemes`         | `TerminalTheme[]`                                     | `[]`    | 所有终端主题      |
| `isPreviewingTerminalTheme` | `boolean`                                             | `false` | 是否正在预览主题  |
| `previewTerminalThemeData`  | `ITheme \| null`                                      | `null`  | 预览主题数据      |
| `localHtmlPresets`          | `Array<{ name: string; type: 'preset' \| 'custom' }>` | `[]`    | 本地 HTML 预设    |
| `remoteHtmlPresets`         | `Array<{ name: string; downloadUrl?: string }>`       | `[]`    | 远程 HTML 预设    |
| `isLoadingHtmlPresets`      | `boolean`                                             | `false` | HTML 预设加载状态 |

---

## 8. 前端设置变量

> 定义位置：`packages/backend/src/settings/settings.repository.ts` (默认值)
> 存储位置：`settings` 表 (JSON 格式存储)

### 8.1 安全设置

| 设置键               | 类型     | 默认值    | 描述                     |
| -------------------- | -------- | --------- | ------------------------ |
| `ipWhitelistEnabled` | `string` | `'false'` | IP 白名单是否启用        |
| `ipWhitelist`        | `string` | `''`      | IP 白名单列表 (逗号分隔) |
| `maxLoginAttempts`   | `string` | `'5'`     | 最大登录尝试次数         |
| `loginBanDuration`   | `string` | `'300'`   | 登录失败封禁时长 (秒)    |
| `timezone`           | `string` | `'UTC'`   | 系统时区                 |

### 8.2 终端设置

| 设置键                          | 类型     | 默认值    | 描述             |
| ------------------------------- | -------- | --------- | ---------------- |
| `terminalScrollbackLimit`       | `string` | `'5000'`  | 终端回滚行数上限 |
| `terminalEnableRightClickPaste` | `string` | `'true'`  | 终端右键粘贴     |
| `terminalOutputEnhancerEnabled` | `string` | `'false'` | 终端输出增强器   |

### 8.3 界面设置

| 设置键                              | 类型     | 默认值    | 描述                   |
| ----------------------------------- | -------- | --------- | ---------------------- |
| `navBarVisible`                     | `string` | `'true'`  | 导航栏可见性           |
| `autoCopyOnSelect`                  | `string` | `'false'` | 终端选中自动复制       |
| `showPopupFileEditor`               | `string` | `'false'` | 弹窗文件编辑器         |
| `shareFileEditorTabs`               | `string` | `'true'`  | 共享文件编辑器标签页   |
| `fileManagerShowDeleteConfirmation` | `string` | `'true'`  | 文件管理器删除确认     |
| `quickCommandRowSizeMultiplier`     | `string` | `'1.0'`   | 快捷命令列表行大小乘数 |
| `quickCommandsCompactMode`          | `string` | `'false'` | 快捷指令视图紧凑模式   |

### 8.4 布局设置

| 设置键                       | 类型     | 默认值   | 描述             |
| ---------------------------- | -------- | -------- | ---------------- |
| `layoutTree`                 | `string` | (JSON)   | 布局树结构       |
| `sidebarPaneWidths`          | `string` | (JSON)   | 侧边栏宽度       |
| `workspaceSidebarPersistent` | `string` | `'true'` | 工作区侧边栏固定 |
| `focusSwitcherSequence`      | `string` | (JSON)   | 焦点切换序列     |

### 8.5 Docker 监控设置

| 设置键                        | 类型     | 默认值    | 描述                |
| ----------------------------- | -------- | --------- | ------------------- |
| `dockerStatusIntervalSeconds` | `string` | `'5'`     | Docker 状态刷新间隔 |
| `dockerDefaultExpand`         | `string` | `'false'` | Docker 默认展开详情 |

### 8.6 状态监控设置

| 设置键                         | 类型     | 默认值    | 描述             |
| ------------------------------ | -------- | --------- | ---------------- |
| `statusMonitorIntervalSeconds` | `string` | `'3'`     | 状态监控轮询间隔 |
| `showStatusMonitorIpAddress`   | `string` | `'false'` | 显示 IP 地址     |

### 8.7 文件管理器设置

| 设置键                              | 类型                     | 默认值   | 描述           |
| ----------------------------------- | ------------------------ | -------- | -------------- |
| `fileManagerShowDeleteConfirmation` | `string`                 | `'true'` | 删除确认提示   |
| `parsedFileManagerColWidths`        | `Record<string, number>` | `{}`     | 文件管理器列宽 |

### 8.8 CAPTCHA 设置

| 设置键          | 类型              | 默认值                                      | 描述         |
| --------------- | ----------------- | ------------------------------------------- | ------------ |
| `captchaConfig` | `CaptchaSettings` | `{ enabled: false, provider: 'none', ... }` | CAPTCHA 配置 |

---

## 9. 数据库配置

> 定义位置：`packages/backend/src/database/connection.ts`

| 配置项       | 值                       | 描述                 |
| ------------ | ------------------------ | -------------------- |
| 数据库目录   | `packages/backend/data/` | 数据库文件存储目录   |
| 数据库文件名 | `nexus-terminal.db`      | SQLite 数据库文件    |
| 数据表前缀   | 无 (单表)                | 使用独立表名而非前缀 |

---

## 附录

### A. 变量文件位置索引

| 变量类型            | 文件位置                                               |
| ------------------- | ------------------------------------------------------ |
| 后端环境变量        | `packages/backend/src/config/env.validator.ts`         |
| 后端安全常量        | `packages/backend/src/config/security.config.ts`       |
| 后端速率限制        | `packages/backend/src/config/rate-limit.config.ts`     |
| 后端应用配置        | `packages/backend/src/config/app.config.ts`            |
| 后端主入口          | `packages/backend/src/index.ts`                        |
| Remote Gateway 配置 | `packages/remote-gateway/src/server.ts`                |
| 前端 API 客户端     | `packages/frontend/src/utils/apiClient.ts`             |
| 前端状态管理        | `packages/frontend/src/stores/*.store.ts`              |
| 后端设置默认值      | `packages/backend/src/settings/settings.repository.ts` |

### B. 环境变量验证

> 文件位置：`packages/backend/src/config/env.validator.ts`

所有环境变量在应用启动时通过 `validateEnvironment()` 函数进行验证，确保类型安全和格式正确。验证失败将阻止应用启动并输出详细错误信息。

---

**文档生成时间**：2025-12-26
