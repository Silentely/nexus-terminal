# 星枢终端 Docker 环境变量配置

> 本文档整理可通过 Docker/Docker Compose 配置的环境变量。完整的变量参考请查看下方环境变量表格。

::: warning ⚠️ `.env` 生效范围
`.env` 文件**仅对 backend 容器生效**（通过 `env_file` 加载）。Remote Gateway 的变量必须在 `docker-compose.yml` 的 `environment` 段中直接配置，或通过 `${VAR}` 语法从 `.env` 引用（仅 `REMOTE_GATEWAY_API_TOKEN` 等少量变量支持此方式）。
:::

::: danger ⚠️ v1.5.1 环境变量变更
自 v1.5.1 起，以下环境变量**默认值已变更**：

| 变量                           | 旧默认值                   | 新默认值                   |
| ------------------------------ | -------------------------- | -------------------------- |
| `REMOTE_GATEWAY_WS_PORT`       | `8080`                     | `8081`                     |
| `REMOTE_GATEWAY_WS_URL_LOCAL`  | `ws://localhost:8080`      | `ws://localhost:8081`      |
| `REMOTE_GATEWAY_WS_URL_DOCKER` | `ws://remote-gateway:8080` | `ws://remote-gateway:8081` |

如果您的 `.env` 文件中显式设置了这些变量，请同步更新。
:::

---

## 目录

- [1. Backend 服务变量](#1-backend-服务变量)
- [2. Remote Gateway 服务变量](#2-remote-gateway-服务变量)
- [3. 端口配置](#3-端口配置)
- [4. 完整配置示例](#4-完整配置示例)

---

## 1. Backend 服务变量

> **配置方式**: 在 `.env` 文件中配置，`docker-compose.yml` 会自动加载

| 变量名            | 默认值           | 必填 | 描述                                        |
| ----------------- | ---------------- | ---- | ------------------------------------------- |
| `DEPLOYMENT_MODE` | `docker`         | 否   | 部署模式: `local` 或 `docker`               |
| `NODE_ENV`        | `production`     | 否   | 运行环境: `development`/`production`/`test` |
| `PORT`            | `3001`           | 否   | 后端服务端口                                |
| `APP_NAME`        | `Nexus Terminal` | 否   | 应用名称                                    |

### Passkey 认证配置

| 变量名      | 默认值                  | 必填                         | 描述                                                                |
| ----------- | ----------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `RP_ID`     | `localhost`             | 否（Passkey 功能启用时必填） | WebAuthn RP ID。可单值（跨域共享 Passkey 推荐）或多值（按顺序映射） |
| `RP_ORIGIN` | `http://localhost:5173` | 否（Passkey 功能启用时必填） | WebAuthn RP Origin。支持逗号分隔多值（完整 URL）                    |

> 若要实现“一个 Passkey 跨多个完全不同域名”，请使用单一 `RP_ID` + 多个 `RP_ORIGIN`，并确保 RP_ID 域名可访问 `/.well-known/webauthn`。

### 远程网关地址配置

| 变量名                           | 默认值                       | 描述                                 |
| -------------------------------- | ---------------------------- | ------------------------------------ |
| `REMOTE_GATEWAY_API_BASE_LOCAL`  | `http://localhost:9090`      | 本地开发时远程网关 API 地址          |
| `REMOTE_GATEWAY_API_BASE_DOCKER` | `http://remote-gateway:9090` | Docker 部署时远程网关 API 地址       |
| `REMOTE_GATEWAY_WS_URL_LOCAL`    | `ws://localhost:8081`        | 本地开发时远程网关 WebSocket 地址    |
| `REMOTE_GATEWAY_WS_URL_DOCKER`   | `ws://remote-gateway:8081`   | Docker 部署时远程网关 WebSocket 地址 |

### Remote Gateway API 鉴权（推荐）

> ✅ 建议为远程网关 API 配置共享令牌，避免 token 生成接口在端口被误暴露时可被滥用。

| 变量名                     | 默认值 | 描述                                                                        |
| -------------------------- | ------ | --------------------------------------------------------------------------- |
| `REMOTE_GATEWAY_API_TOKEN` | -      | 共享令牌：backend 请求 Remote Gateway API 时会携带 `X-Remote-Gateway-Token` |

### 安全相关（自动生成）

> ⚠️ 以下变量首次启动时会自动生成到挂载卷 `./data/.env`（容器内路径为 `/app/data/.env`），**不要手动配置**

| 变量名           | 格式        | 描述                   |
| ---------------- | ----------- | ---------------------- |
| `ENCRYPTION_KEY` | 64字符 hex  | 数据库敏感信息加密密钥 |
| `SESSION_SECRET` | 128字符 hex | 会话密钥               |

### 可选配置

| 变量名                       | 默认值   | 描述                                                                                           |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`            | -        | 额外允许的 CORS 来源（逗号分隔多个域名）                                                       |
| `ALLOWED_WS_ORIGINS`         | -        | 额外允许的 WebSocket 来源（逗号分隔多个域名）                                                  |
| `ENABLE_GEO_LOOKUP`          | `true`   | 登录事件 IP 地理位置查询开关。设为 `false` 可禁用（节省外部请求）。                            |
| `GEO_PROVIDER`               | `ip-api` | IP 地理定位提供商：`ip-api`（默认，免费）、`ipinfo`（ipinfo.io）或 `iplocate`（iplocate.io）。 |
| `IPINFO_TOKEN`               | -        | ipinfo.io API Token（可选，提升请求配额至 50k/月）。                                           |
| `IPLOCATE_TOKEN`             | -        | iplocate.io API Key（可选，提升请求配额与速率限制）。                                          |
| `IP_API_USE_HTTPS`           | `false`  | IP 地理定位 API 是否使用 HTTPS                                                                 |
| `HEARTBEAT_INTERVAL_DESKTOP` | `30000`  | 桌面端心跳间隔（毫秒）                                                                         |
| `HEARTBEAT_INTERVAL_MOBILE`  | `12000`  | 移动端心跳间隔（毫秒）                                                                         |
| `MAX_MISSED_PONGS_DESKTOP`   | `1`      | 桌面端最大允许丢失 pong 次数，超过则断开连接                                                   |
| `MAX_MISSED_PONGS_MOBILE`    | `3`      | 移动端最大允许丢失 pong 次数，超过则断开连接                                                   |
| `ENABLE_MULTIPLEX`           | `false`  | WebSocket 多路复用开关。设为 `true` 启用单连接多会话模式                                       |
| `TRUST_PROXY`                | -        | 是否信任代理 (`true`/`false`)                                                                  |
| `TRUST_PROXY_HOPS`           | -        | 信任的代理跳数                                                                                 |
| `SHELL`                      | -        | 终端默认 Shell（如 `/bin/bash`）                                                               |
| `METRICS_TOKEN`              | -        | Prometheus 指标端点访问令牌（保护 `/api/v1/metrics`）                                          |
| `LOG_LEVEL`                  | `info`   | 后端日志等级（`debug/info/warn/error/silent`）                                                 |
| `LOG_PRETTY`                 | -        | 日志格式化开关。`true`=pino-pretty 彩色输出，`false`=JSON。dev 模式默认开启                    |
| `LOG_REDACT`                 | -        | 日志脱敏开关。设为 `false` 可关闭敏感信息脱敏（默认开启）                                      |
| `LOG_TZ`                     | -        | 日志时间戳时区（优先级高于 `TZ`）                                                              |
| `ENABLE_REQUEST_LOG`         | `true`   | 启用请求访问日志。设为 `false` 可关闭"请求开始/完成"日志，减少容器日志量                       |
| `ENABLE_HSTS`                | `false`  | 启用 HSTS 安全头（Strict-Transport-Security）。仅生产 HTTPS 环境开启，开发环境勿启用           |
| `TZ`                         | `UTC`    | 后端进程默认时区                                                                               |

### NL2CMD 调试配置

| 变量名                      | 默认值  | 范围        | 描述                                 |
| --------------------------- | ------- | ----------- | ------------------------------------ |
| `NL2CMD_TIMING_LOG`         | `0`     | `0` / `1`   | 是否启用计时日志（开发模式自动启用） |
| `NL2CMD_SLOW_THRESHOLD_MS`  | `3000`  | 0-300000    | 慢查询阈值（毫秒），超过会记录警告   |
| `NL2CMD_REQUEST_TIMEOUT_MS` | `30000` | 1000-300000 | NL2CMD 上游 HTTP 请求超时（毫秒）    |

> ⚠️ **注意**: NL2CMD 的 AI 配置（API Key、Provider、Model 等）存储在**数据库**中，通过前端设置页面 (`/settings/ai`) 或 API 配置。

---

## 2. Remote Gateway 服务变量

> **配置方式**: 在 `docker-compose.yml` 的 `remote-gateway` 服务的 `environment` 中直接配置
> **⚠️ 重要**: Remote Gateway **不读取 `.env` 文件**，仅 `docker-compose.yml` 中通过 `${VAR}` 语法引用的变量会从 `.env` 解析。其他变量必须直接写在 `environment` 段中。

### 端口配置

| 变量名                    | 默认值 | 描述                                           |
| ------------------------- | ------ | ---------------------------------------------- |
| `REMOTE_GATEWAY_API_PORT` | `9090` | Remote Gateway API 端口（Docker 内部通信端口） |
| `REMOTE_GATEWAY_WS_PORT`  | `8081` | Guacamole WebSocket 端口                       |

### Guacd 连接

| 变量名       | 默认值      | 描述                                             |
| ------------ | ----------- | ------------------------------------------------ |
| `GUACD_HOST` | `localhost` | Guacd 服务地址（内嵌于同一容器，默认 localhost） |
| `GUACD_PORT` | `4822`      | Guacd 服务端口                                   |

### CORS 白名单

| 变量名             | 默认值                | 描述                             |
| ------------------ | --------------------- | -------------------------------- |
| `FRONTEND_URL`     | `http://frontend`     | 前端 URL（始终加入 CORS 白名单） |
| `MAIN_BACKEND_URL` | `http://backend:3001` | 后端 URL（始终加入 CORS 白名单） |

> **代码默认值说明**：Remote Gateway 代码中的默认值为 `http://localhost:5173` 和 `http://localhost:3001`。Docker Compose 配置通过环境变量覆盖为容器服务名 `http://frontend` 和 `http://backend:3001`，实现容器间通信。

### API 鉴权

| 变量名                     | 默认值 | 描述                                                   |
| -------------------------- | ------ | ------------------------------------------------------ |
| `REMOTE_GATEWAY_API_TOKEN` | -      | 共享令牌。若配置，backend 的 `.env` 中也必须配置相同值 |

> ⚠️ 生产环境**强烈推荐**配置此令牌。未配置时，生产模式下会输出警告日志。

### 可选配置

| 变量名                 | 默认值       | 描述                                     |
| ---------------------- | ------------ | ---------------------------------------- |
| `CORS_ALLOWED_ORIGINS` | -            | 额外允许的 CORS 来源（逗号分隔多个域名） |
| `CORS_ALLOW_ALL`       | `false`      | 是否允许所有来源（⚠️ 仅开发环境使用）    |
| `NODE_ENV`             | `production` | 运行环境                                 |

---

## 3. 端口配置

### docker-compose.yml 端口映射

| 服务           | 外部端口      | 容器端口 | 描述                                         |
| -------------- | ------------- | -------- | -------------------------------------------- |
| frontend       | `18111`       | `8080`   | Web 应用访问端口                             |
| backend        | `3001` (内部) | `3001`   | API 服务端口                                 |
| remote-gateway | - (内部)      | `8081`   | Guacamole WebSocket 端口（backend 内部代理） |
| remote-gateway | - (内部)      | `9090`   | API 服务端口                                 |
| guacd          | - (内部)      | `4822`   | Guacamole 协议端口                           |

### 外部访问端口

| 端口    | 服务     | 协议 |
| ------- | -------- | ---- |
| `18111` | frontend | HTTP |

---

## 4. 完整配置示例

### `.env` 文件示例

> 以下变量**仅对 backend 容器生效**。Remote Gateway 端口、Guacd 连接等变量需在 `docker-compose.yml` 中配置。

```dotenv
# ===== 部署模式 =====
DEPLOYMENT_MODE=docker

# ===== Passkey 配置（生产环境必须修改）=====
# 单域名
RP_ID=yourdomain.com
RP_ORIGIN=https://yourdomain.com
# 一个 Passkey 跨多个独立域名（Related Origins）
# RP_ID=yourdomain.com
# RP_ORIGIN=https://yourdomain.com,https://another-domain.net
# 并确保 https://yourdomain.com/.well-known/webauthn 可访问

# ===== 远程网关地址（backend 连接 remote-gateway 用）=====
REMOTE_GATEWAY_API_BASE_LOCAL=http://localhost:9090
REMOTE_GATEWAY_API_BASE_DOCKER=http://remote-gateway:9090
REMOTE_GATEWAY_WS_URL_LOCAL=ws://localhost:8081
REMOTE_GATEWAY_WS_URL_DOCKER=ws://remote-gateway:8081

# ===== Remote Gateway API 鉴权 =====
# 共享令牌：backend 与 remote-gateway 必须使用相同值
# backend 通过 .env 读取，remote-gateway 通过 docker-compose.yml 的 ${REMOTE_GATEWAY_API_TOKEN} 引用
REMOTE_GATEWAY_API_TOKEN=

# ===== 代理配置（反向代理/Cloudflare 场景）=====
# TRUST_PROXY=true
# TRUST_PROXY_HOPS=1

# ===== IP 地理位置查询 =====
# ENABLE_GEO_LOOKUP=true
# GEO_PROVIDER=ip-api
# IPINFO_TOKEN=
# IP_API_USE_HTTPS=false
# IP 地理位置数据由 IPLocate (https://iplocate.io) 提供

# ===== WebSocket 多路复用 =====
# ENABLE_MULTIPLEX=false

# ===== 心跳与连接保活 =====
# HEARTBEAT_INTERVAL_DESKTOP=30000
# HEARTBEAT_INTERVAL_MOBILE=12000
# MAX_MISSED_PONGS_DESKTOP=1
# MAX_MISSED_PONGS_MOBILE=3

# ===== CORS 额外白名单 =====
# ALLOWED_ORIGINS=https://yourdomain.com
# ALLOWED_WS_ORIGINS=https://yourdomain.com

# ===== 监控与日志 =====
# ENABLE_METRICS=false
# METRICS_TOKEN=
# LOG_LEVEL=info
# LOG_PRETTY=
# LOG_REDACT=
# LOG_TZ=
# ENABLE_REQUEST_LOG=true
# ENABLE_HSTS=false
# TZ=UTC

# ===== 终端配置 =====
# SHELL=/bin/bash

# ===== 前端构建时变量（可选，仅自构建 frontend 镜像时生效）=====
# VITE_NOTIFICATION_TIMEOUT_MS=3000
# VITE_API_BASE_URL=

# ===== Rate Limit（可选）=====
# API_RATE_LIMIT_WINDOW_MS=900000
# API_RATE_LIMIT_MAX=300
# SETTINGS_RATE_LIMIT_WINDOW_MS=900000
# SETTINGS_RATE_LIMIT_MAX=500
```

## Rate Limit（后端限流）

后端使用 `express-rate-limit` 进行基础限流。默认值已经相对宽松，但在反向代理/Cloudflare 场景或前端多接口并发加载时，仍可能触发 `429`。

可通过以下环境变量调节（单位：毫秒 ms；仅支持正整数，缺省或非法会回退默认值）：

```dotenv
# 通用 API（除 auth/AI 等特殊路由外）
API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=300

# Settings API（/api/v1/settings/*）
SETTINGS_RATE_LIMIT_WINDOW_MS=900000
SETTINGS_RATE_LIMIT_MAX=500
```

### docker-compose.yml 完整配置

```yaml
services:
  frontend:
    image: ghcr.io/silentely/nexus-terminal-frontend:latest
    container_name: nexus-terminal-frontend
    ports:
      - '18111:8080'
    depends_on:
      - backend
      - remote-gateway
    networks:
      - nexus-terminal-network
    restart: unless-stopped

  backend:
    image: ghcr.io/silentely/nexus-terminal-backend:latest
    container_name: nexus-terminal-backend
    env_file:
      - .env # ← 仅 backend 读取 .env
    environment:
      NODE_ENV: production
      PORT: 3001
    volumes:
      - ./data:/app/data
    networks:
      - nexus-terminal-network
    restart: unless-stopped

  # Remote Gateway：内嵌 guacd，guacd 进程与 Node.js 共享同一容器
  # RDP/VNC 连接由 backend 通过 /rdp-proxy WebSocket 内部代理，无需暴露端口
  remote-gateway:
    image: ghcr.io/silentely/nexus-terminal-remote-gateway:latest
    container_name: nexus-terminal-remote-gateway
    environment:
      # guacd 已内嵌于本容器，使用 localhost 连接
      GUACD_HOST: localhost
      GUACD_PORT: 4822
      REMOTE_GATEWAY_API_PORT: 9090
      REMOTE_GATEWAY_WS_PORT: 8081
      FRONTEND_URL: http://frontend
      MAIN_BACKEND_URL: http://backend:3001
      NODE_ENV: production
      # Remote Gateway API 访问令牌（可选但强烈推荐）
      # 若配置，则 backend（.env）与 remote-gateway 必须使用相同值
      REMOTE_GATEWAY_API_TOKEN: ${REMOTE_GATEWAY_API_TOKEN}
      # CORS 配置（可选）
      # CORS_ALLOWED_ORIGINS: https://yourdomain.com
      # CORS_ALLOW_ALL: false  # ⚠️ 仅开发环境使用
    networks:
      - nexus-terminal-network
    depends_on:
      - backend
    restart: unless-stopped

networks:
  nexus-terminal-network:
    driver: bridge
```

### 前端构建时变量（可选）

| 变量名                         | 默认值 | 描述                                                                  |
| ------------------------------ | ------ | --------------------------------------------------------------------- |
| `VITE_NOTIFICATION_TIMEOUT_MS` | `3000` | 前端通知自动关闭时间（毫秒）。仅支持正整数，缺省/非法值会回退默认值。 |
| `VITE_API_BASE_URL`            | -      | 前端拼接后端静态资源地址的基础 URL（如背景图 URL）。                  |

> 重要说明：
>
> - 该变量是 **Vite 构建时变量**，通过 `import.meta.env` 读取。
> - 使用 `ghcr.io/silentely/nexus-terminal-frontend:latest` 预构建镜像时，运行时注入此变量不会生效。
> - 如需自定义，请改为自行构建 frontend 镜像，并在构建阶段传入。

示例（改为 build 模式）：

```yaml
services:
  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
      args:
        VITE_NOTIFICATION_TIMEOUT_MS: ${VITE_NOTIFICATION_TIMEOUT_MS:-3000}
        VITE_API_BASE_URL: ${VITE_API_BASE_URL:-}
    ports:
      - '18111:8080'
    depends_on:
      - backend
      - remote-gateway
```

---

## 快速配置清单

### 首次部署（生产环境）

1. ✅ 修改 `.env` 中的 `RP_ID` 与 `RP_ORIGIN`
2. ✅ 若希望”一个 Passkey 跨多域名”，使用单一 `RP_ID` + 多个 `RP_ORIGIN`
3. ✅ 确保 RP_ID 域名可访问 `/.well-known/webauthn`
4. ✅ 确保 `ALLOWED_ORIGINS` / 反向代理 CORS 配置包含所有前端域名
5. ✅ 启动服务：`docker compose up -d`

---

## 5. 内置安全特性

> 以下安全防护已在代码层面实现，无需额外配置。了解这些特性有助于排查问题。

### SSRF 防护

以下模块已内置 SSRF 防护，DNS 解析后检查目标 IP 是否指向私网（127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16 等），私网地址请求会被拒绝并返回错误信息：

- **外观模块** — HTML 主题远程加载
- **AI 智能运维** — NL2CMD 的 URL 抓取功能
- **WebRTC 远程桌面桥接** — 验证 `remoteGatewayUrl` 不指向私有/内部地址，阻止恶意网关 URL 建立 WebSocket 连接
- **SSRF DNS 缓存** — 使用 `ipaddr.js` 检测 IP 地址格式，避免直接 IP 被误缓存为域名

无需配置，自动生效。

### 命令注入防护

Docker 容器管理和批量命令执行已内置命令注入防护：

- 容器 ID 校验：仅允许字母、数字、连字符、下划线，非法输入直接拒绝
- 批量命令校验：拒绝包含反引号、`$()`、分号、管道符等 shell 元字符的命令
- 无需配置，自动生效

### 路径穿越防护

文件上传/下载路径已内置路径穿越校验：

- 使用 `path.resolve()` + `startsWith()` 确保路径不会逃逸出允许的目录
- 影响模块：外观设置（背景图上传）、终端主题（主题导入）、会话挂起（日志存储）
- 无需配置，自动生效

---

**文档生成时间**：2025-12-26 | **最后更新**：2026-05-08（新增内置安全特性说明）
