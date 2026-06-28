# 部署教程

本指南帮助您快速部署 Nexus Terminal，从零开始搭建完整的远程管理平台。

::: danger ⚠️ v1.5.1 升级重要提示
自 v1.5.1 起，**容器运行用户由 root 调整为非 root 用户**，以下端口发生变更：

| 服务                     | 旧端口 | 新端口 | 说明                     |
| ------------------------ | ------ | ------ | ------------------------ |
| Frontend nginx           | `80`   | `8080` | 容器内部监听端口         |
| Remote Gateway WebSocket | `8080` | `8081` | Guacamole WebSocket 端口 |

**升级时必须更新**：`docker-compose.yml` 端口映射、宿主机 Nginx 反向代理配置、`.env` 中的环境变量默认值。

[更新日志](./changelog)中有 v1.5.1 破坏性变更的完整说明。
:::

## 前置要求

::: info 系统要求

- **操作系统**：Linux（推荐 Debian/Ubuntu）、macOS、Windows
- **Docker**：版本 20.10+
- **Docker Compose**：版本 2.0+
- **内存**：建议 2GB+（根据连接数量调整）
- **磁盘**：至少 1GB 可用空间
  :::

## 一键部署（推荐）

### 第一步：创建目录

```bash
mkdir nexus-terminal && cd nexus-terminal
```

### 第二步：下载配置文件

从 GitHub 仓库下载 `docker-compose.yml` 和 `.env` 配置文件：

```bash
wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/.env -O .env
```

::: warning 注意
当前默认镜像仓库为 GitHub Container Registry（GHCR），命名空间：`ghcr.io/silentely`
:::

### 第三步：启动服务

```bash
docker compose up -d
```

等待所有容器启动完成（首次启动需要拉取镜像，可能需要几分钟）。

### 第四步：访问服务

打开浏览器，访问：**http://your-server-ip:18111**

::: tip 提示
默认端口为 `18111`，可在 `.env` 文件中修改。
:::

::: warning 安全提示
`http://your-server-ip:18111` 仅适合内网学习、测试或首次验证服务是否启动。不要把明文 HTTP 登录入口直接暴露到公网；公网生产环境应配置 HTTPS 反向代理（Nginx/Caddy/Cloudflare Tunnel 等）。

默认会话 Cookie 使用 `SESSION_COOKIE_SECURE=auto`：HTTP 直连时允许登录，HTTPS 反代时自动设置 Secure Cookie。如需强制只允许 HTTPS 会话，可在 `.env` 中设置 `SESSION_COOKIE_SECURE=true`。
:::

## 架构说明

Docker 部署包含三个容器，职责如下：

| 容器               | 内部端口                      | 职责                                                                |
| ------------------ | ----------------------------- | ------------------------------------------------------------------- |
| **frontend**       | 8080                          | 静态资源托管 + 反向代理（转发 `/api/` → backend、`/ws/` → backend） |
| **backend**        | 3001                          | API 服务、SSH/SFTP 连接管理、认证、审计                             |
| **remote-gateway** | 8081 (WebSocket) / 9090 (API) | Guacamole 网关，处理 RDP/VNC 远程桌面连接                           |

::: warning 注意
前端容器的 nginx 默认只代理 `/api/` 和 `/ws/` 到 backend。**`/guacamole/` 不会自动转发到 remote-gateway**，需要在宿主机 Nginx 中单独处理（[Nginx 反向代理配置](./deployment/nginx)中有详细步骤）。
:::

## 手动 Docker Compose 部署

如果需要自定义配置，可以手动编写 `docker-compose.yml`：

### 第一步：创建项目目录

```bash
mkdir -p /opt/nexus-terminal && cd /opt/nexus-terminal
```

### 第二步：创建 docker-compose.yml

```yaml
services:
  frontend:
    container_name: nexus-terminal-frontend
    ports:
      - '127.0.0.1:18111:8080'
    depends_on:
      backend:
        condition: service_healthy
      remote-gateway:
        condition: service_healthy
    networks:
      - nexus-terminal-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/ > /dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
    image: ghcr.io/silentely/nexus-terminal-frontend:latest

  backend:
    container_name: nexus-terminal-backend
    env_file:
      - .env
    environment:
      PORT: 3001
      NODE_ENV: production
      TZ: Asia/Shanghai
    volumes:
      - ./data:/app/data
    networks:
      - nexus-terminal-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3001/api/v1/health > /dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    image: ghcr.io/silentely/nexus-terminal-backend:latest

  remote-gateway:
    container_name: nexus-terminal-remote-gateway
    ports:
      - '127.0.0.1:8081:8081' # Guacamole WebSocket（宿主机 Nginx 需要直连）
    environment:
      NODE_ENV: production
      GUACD_HOST: localhost
      GUACD_PORT: 4822
      REMOTE_GATEWAY_API_PORT: 9090
      REMOTE_GATEWAY_WS_PORT: 8081
      FRONTEND_URL: http://frontend
      MAIN_BACKEND_URL: http://backend:3001
      REMOTE_GATEWAY_API_TOKEN: ${REMOTE_GATEWAY_API_TOKEN}
    networks:
      - nexus-terminal-network
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:9090/health > /dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
    image: ghcr.io/silentely/nexus-terminal-remote-gateway:latest

networks:
  nexus-terminal-network:
    driver: bridge
```

::: tip 启动顺序说明
`depends_on` 配合 `condition: service_healthy` 确保：
1. **backend** 先启动，等待健康检查通过（`start_period: 30s` 给予初始化时间）
2. **remote-gateway** 等待 backend 健康后启动
3. **frontend** 最后启动，此时后端已完全就绪，API 请求不会返回 503
:::

### 第三步：创建 .env 文件

```bash
cat > .env << 'EOF'
DEPLOYMENT_MODE=docker
NODE_ENV=production
APP_NAME=Nexus Terminal
PORT=3001
REMOTE_GATEWAY_API_TOKEN=
EOF
```

::: tip 提示
首次启动后，`ENCRYPTION_KEY` 和 `SESSION_SECRET` 会自动生成并写入 `./data/.env`，无需手动配置。
:::

### 第四步：启动服务

```bash
docker compose up -d
```

### 常用操作

```bash
# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f backend

# 重启单个服务
docker compose restart backend

# 更新镜像
docker compose pull && docker compose up -d
```

## 环境变量配置

### 核心变量

编辑 `.env` 文件，配置以下关键变量：

```dotenv
# 部署模式
DEPLOYMENT_MODE=docker

# 运行环境
NODE_ENV=production

# 应用名称
APP_NAME=Nexus Terminal

# 后端端口（容器内部）
PORT=3001
```

### 安全配置

```dotenv
# 加密密钥（自动生成，首次启动时创建）
# 请勿手动修改，除非您知道自己在做什么
ENCRYPTION_KEY=

# 会话密钥（自动生成）
SESSION_SECRET=

# HSTS 安全头（仅生产 HTTPS 环境开启）
# 开启后浏览器会强制使用 HTTPS 访问，开发环境勿启用
ENABLE_HSTS=false

# 会话 Cookie Secure 策略
# auto：HTTP 直连可登录，HTTPS 反代时自动使用 Secure Cookie
# 公网生产如需强制只允许 HTTPS 会话，可设置为 true
SESSION_COOKIE_SECURE=auto
```

### Passkey 认证（可选）

如果需要启用 Passkey 登录：

```dotenv
# Passkey Relying Party ID（域名，不带协议）
RP_ID=your-domain.com

# Passkey Relying Party Origin（完整 URL）
RP_ORIGIN=https://your-domain.com
```

::: warning 安全提示

- `RP_ID` 需填写您的域名（不带协议和端口）
- `RP_ORIGIN` 需填写完整的 URL（包含协议）
- 启用 Passkey 后，检查 `/.well-known/webauthn` 是否可访问
  :::

### Remote Gateway API 鉴权（推荐）

```dotenv
# 共享令牌：backend 与 remote-gateway 需要使用相同值
REMOTE_GATEWAY_API_TOKEN=
```

> [环境变量配置](./configuration/docker)中有完整的变量列表和说明。

### Prometheus 监控（可选）

```dotenv
# 启用 Prometheus 端点
ENABLE_METRICS=true
```

启用后可通过 `http://localhost:3001/api/v1/metrics` 访问指标数据。

## Nginx 反向代理配置

生产环境部署建议使用 Nginx 反向代理，提供 SSL 终止、静态资源缓存和 WebSocket 代理。

[Nginx 反向代理配置指南](./deployment/nginx)包含以下内容：

- 基础 HTTP 配置与 Docker Compose 部署配置
- HTTPS/SSL 证书配置（Let's Encrypt 与自签名）
- WebSocket 代理详解（SSH 终端 + 远程桌面）
- 负载均衡、安全加固与性能优化
- 常见问题排查

## 更新与维护

### 更新到最新版本

```bash
cd nexus-terminal
docker compose down
docker compose pull
docker compose up -d
```

::: tip 零停机更新
`docker compose pull` 后再 `up -d`，会自动创建新容器替换旧容器。
:::

### 查看日志

```bash
# 所有容器
docker compose logs -f

# 特定容器
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f remote-gateway
```

### 重启服务

```bash
docker compose restart          # 全部
docker compose restart backend  # 单个
```

## 数据备份与恢复

### 备份数据

数据存储在 `./data` 目录（SQLite 数据库、会话、上传文件）：

```bash
docker compose stop backend
tar -czf nexus-terminal-backup-$(date +%Y%m%d).tar.gz data/
docker compose start backend
```

### 使用内置 API 备份

```bash
# 导出
curl -X GET http://localhost:18111/api/v1/backup/export \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o backup.json

# 导入
curl -X POST http://localhost:18111/api/v1/backup/import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@backup.json"
```

### 恢复数据

```bash
docker compose stop backend
tar -xzf nexus-terminal-backup-20240101.tar.gz
docker compose start backend
```

## ARM 架构支持

### ARM64（aarch64）

完全支持，无需额外配置。`remote-gateway` 镜像已内嵌 guacd。

### ARMv7（armhf）

::: warning ARMv7 限制
Apache Guacamole 未提供 guacd 的 ARMv7 镜像，RDP 功能将被禁用。
:::

上方 Docker 部署章节中有详细说明。

## 健康检查

```bash
# 查看容器健康状态
docker compose ps

# 后端健康端点
curl -f http://localhost:18111/api/v1/health

# 前端
curl -f http://localhost:18111/

# Prometheus 指标（需启用）
curl http://localhost:18111/api/v1/metrics
```

## 常见部署问题

### 容器无法启动

```bash
docker compose logs backend          # 查看日志
sudo lsof -i:18111                   # 检查端口占用
cat .env                             # 检查环境变量
```

### WebSocket 连接失败

1. 检查 Nginx WebSocket 配置中 `Upgrade` 和 `Connection` 头
2. 确保防火墙允许 WebSocket 端口
3. 确认使用 HTTPS（浏览器限制非 HTTPS 下的剪贴板）

### 数据库锁定

```bash
docker compose down
sudo chown -R 1000:1000 data/
docker compose up -d
```

### 内存不足

1. 增加服务器内存
2. 调整 `docker-compose.yml` 中的内存限制
3. 减少并发连接数量

## 最佳实践

::: tip 生产环境建议

1. **使用 HTTPS**：浏览器限制非 HTTPS 环境下的终端复制功能
2. **配置防火墙**：仅开放必要端口（80/443）
3. **定期备份**：建议每日自动备份数据
4. **监控资源**：设置 CPU/内存/磁盘告警
5. **日志轮转**：配置 Docker 日志驱动限制日志大小
   :::
