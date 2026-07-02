# 常见问题

## 部署相关

### 启动后 API 返回 503 Service Unavailable？

**原因**：Docker 容器启动竞态条件。`depends_on` 默认只等待容器进程启动，不等待服务就绪。前端容器的 Nginx 在后端尚未完成初始化时就尝试代理请求，导致 503。

**解决方案**：在 `docker-compose.yml` 中使用健康检查条件：

```yaml
frontend:
  depends_on:
    backend:
      condition: service_healthy
    remote-gateway:
        condition: service_healthy

backend:
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:3001/api/v1/health > /dev/null 2>&1 || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s  # 给予后端初始化时间
```

同时确保前端容器的 `nginx.conf` 中 `/api/` 使用正确的连接头映射：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location ^~ /api/ {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;  # 不要硬编码 "upgrade"
    proxy_next_upstream error timeout http_502 http_503;
}
```

### 为什么选择 Docker 部署？

- **一键部署** — 无需手动安装依赖
- **环境隔离** — 避免与系统其他服务冲突
- **易于维护** — 更新和回滚流程清晰
- **跨平台** — 支持 Linux、macOS、Windows

### 最低系统要求是什么？

| 资源 | 最低要求      | 推荐配置     |
| ---- | ------------- | ------------ |
| CPU  | 1 核          | 2 核+        |
| 内存 | 1GB           | 2GB+         |
| 磁盘 | 1GB           | 5GB+         |
| 系统 | Docker 20.10+ | Docker 24.0+ |

### 如何修改默认端口 18111？

编辑 `docker-compose.yml` 中的端口映射：

```yaml
frontend:
  ports:
    - '8080:8080' # 修改左侧宿主机端口即可
```

### 从 v1.5.0 升级到 v1.5.1 后容器启动失败怎么办？

v1.5.1 将容器运行用户从 root 切换为非 root，导致内部端口发生变更。常见问题及解决方法：

**问题 1：Frontend 容器健康检查失败**

现象：`docker compose ps` 显示 frontend 为 `unhealthy`

原因：旧配置中 nginx 监听 `80`，新版本监听 `8080`

解决：更新 `docker-compose.yml` 中的端口映射和 healthcheck：

```yaml
frontend:
  ports:
    - '18111:8080' # 旧值: '18111:80'
  healthcheck:
    test: ['CMD-SHELL', 'wget -qO- http://localhost:8080/ > /dev/null 2>&1 || exit 1']
```

**问题 2：远程桌面（RDP/VNC）连接失败**

现象：前端可以访问但无法连接远程桌面

原因：Remote Gateway WebSocket 端口从 `8080` 改为 `8081`

> **Docker Compose 部署注意**：Docker 版本中 `remote-gateway` 仅由 `backend` 容器内部访问（`ws://remote-gateway:8081`），外层 Nginx **无需**单独转发 remote-gateway。RDP/VNC 的完整路径为：浏览器 → 外层 Nginx(`/ws/`) → 前端容器(18111) → 内置 nginx → backend(3001) → remote-gateway(8081)。只需确保外层 Nginx 正确代理 `/ws/` 到 `18111` 即可。
>
> 如果通过 HTTPS 域名访问且遇到 WebSocket 信令连接失败，请在 `.env` 中设置 `RP_ORIGIN=https://your-domain.com` 或 `ALLOWED_WS_ORIGINS=https://your-domain.com`。

解决（非 Docker 或自定义 Nginx 代理到 remote-gateway 的场景）：更新宿主机 Nginx 配置中 `/guacamole/` 的代理目标：

```nginx
# 旧配置
proxy_pass http://127.0.0.1:8080;

# 新配置
proxy_pass http://127.0.0.1:8081;
```

同时更新 `.env` 中的环境变量（如果显式设置了旧值）：

```dotenv
# 旧值
REMOTE_GATEWAY_WS_PORT=8080
REMOTE_GATEWAY_WS_URL_LOCAL=ws://localhost:8080
REMOTE_GATEWAY_WS_URL_DOCKER=ws://remote-gateway:8080

# 新值
REMOTE_GATEWAY_WS_PORT=8081
REMOTE_GATEWAY_WS_URL_LOCAL=ws://localhost:8081
REMOTE_GATEWAY_WS_URL_DOCKER=ws://remote-gateway:8081
```

**问题 3：`data/.env` 文件权限被拒绝**

现象：容器启动时报 `EACCES: permission denied`

原因：新版本将 `data/.env` 权限收紧为 `600`

解决：容器 entrypoint 会在启动时自动修复权限，无需手动处理。如果仍有问题，执行：

```bash
docker compose down
sudo chown -R $(id -u):$(id -g) ./data
docker compose up -d
```

**完整升级步骤：**

```bash
# 1. 停止旧版本
docker compose down

# 2. 更新 docker-compose.yml（参考上方端口变更）

# 3. 更新宿主机 Nginx 配置

# 4. 拉取新镜像并启动
docker compose pull && docker compose up -d

# 5. 验证容器状态
docker compose ps
docker compose logs -f
```

### 可以不用 Docker 部署吗？

可以，参考本地开发方式：

```bash
npm install
cd packages/backend && npm run dev
cd packages/frontend && npm run dev
cd packages/remote-gateway && npm run dev
```

## 连接问题

### SSH 连接失败怎么办？

1. 确认服务器地址和端口正确
2. 确认用户名和密码/密钥正确
3. 确认服务器防火墙允许 SSH 连接
4. 查看后端日志：`docker compose logs backend | grep ssh`

### RDP/VNC 连接黑屏？

- **Guacd 未启动** — 检查 remote-gateway 容器日志
- **协议不支持** — 确认远程服务器开启了 RDP/VNC
- **网络问题** — 确认 Guacd 端口可达

### WebSocket 连接频繁断开？

调整心跳配置：

```dotenv
HEARTBEAT_INTERVAL_DESKTOP=15000
MAX_MISSED_PONGS_DESKTOP=5
```

### 移动端无法复制终端内容？

浏览器安全策略限制，非 HTTPS 环境下无法使用剪贴板。解决方案：

1. 配置 HTTPS（推荐）
2. 使用 localhost 访问（仅限开发环境）

## 数据相关

### 数据存储在哪里？

所有数据存储在 `./data` 目录：

```
data/
├── nexus-terminal.db    # SQLite 数据库
└── sessions/            # 会话文件
```

### 如何备份数据？

```bash
docker compose stop backend
tar -czf backup.tar.gz data/
docker compose start backend
```

### 如何恢复数据？

```bash
docker compose stop backend
tar -xzf backup.tar.gz
docker compose start backend
```

## 安全相关

### 如何启用 HTTPS？

推荐使用 Nginx + Let's Encrypt：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 如何配置 IP 白名单？

通过应用界面：设置 → 安全 → IP 白名单 → 添加 IP 地址。

### Passkey 登录失败？

检查以下配置：

1. `RP_ID` 和 `RP_ORIGIN` 是否正确
2. 访问地址是否与 `RP_ORIGIN` 匹配
3. 是否使用 HTTPS（Passkey 要求）
4. `/.well-known/webauthn` 是否可访问

```bash
curl https://your-domain.com/.well-known/webauthn
```

## 性能相关

### 如何支持更多并发连接？

1. 增加服务器资源（CPU、内存）
2. 调整系统参数：`sudo sysctl -w net.core.somaxconn=65535`
3. 调整容器内存限制

### 终端响应慢？

- **网络延迟** — 检查服务器到目标机器的网络
- **服务器负载** — 检查远程服务器负载
- **浏览器性能** — 尝试减少终端标签页数量

### 数据库锁定错误？

```bash
docker compose down
sqlite3 data/nexus-terminal.db ".tables"
docker compose up -d
```

## 更新相关

### 如何更新到最新版本？

```bash
cd nexus-terminal
docker compose down
docker compose pull
docker compose up -d
```

### 更新会丢失数据吗？

不会。数据存储在挂载的 `./data` 目录，更新镜像不影响数据。

### 如何回滚到旧版本？

修改 `docker-compose.yml` 中的镜像标签：

```yaml
services:
  backend:
    image: ghcr.io/silentely/nexus-terminal-backend:v1.0.0
```

然后 `docker compose up -d`。

## 开发相关

### 如何贡献代码？

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改
4. 创建 Pull Request

### 如何运行测试？

```bash
npm test                 # 所有测试
npm run test:backend     # 后端测试
npm run test:frontend    # 前端测试
npm run test:coverage    # 覆盖率报告
```

## 其他

### 项目支持哪些协议？

| 协议   | 状态     | 说明                |
| ------ | -------- | ------------------- |
| SSH    | 完全支持 | 终端连接            |
| SFTP   | 完全支持 | 文件传输            |
| RDP    | 完全支持 | Windows 远程桌面    |
| VNC    | 完全支持 | Unix/Linux 图形桌面 |
| Telnet | 完全支持 | 传统设备终端连接    |

### 有移动端 App 吗？

目前没有原生 App，但 Web 界面完美适配移动端浏览器，支持触控操作和手势控制。

### 如何获取帮助？

- [GitHub Issues](https://github.com/Silentely/nexus-terminal/issues) — 报告 Bug 或请求功能
- [GitHub Discussions](https://github.com/Silentely/nexus-terminal/discussions) — 提问和讨论
