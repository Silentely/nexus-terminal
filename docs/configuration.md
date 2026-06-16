# 高级配置

本指南涵盖 Nexus Terminal 的高级配置选项，包括 CORS、Passkey、WebSocket、日志和防火墙等。

## 配置入口

| 配置项    | 文档链接                                      | 说明                                                         |
| --------- | --------------------------------------------- | ------------------------------------------------------------ |
| 环境变量  | [Docker 环境变量配置](./configuration/docker) | 完整的环境变量参考，含 Backend 和 Remote Gateway             |
| CORS 跨域 | [CORS 跨域配置](./configuration/cors)         | 自定义域名、多域名、开发环境 CORS 配置                       |
| 本页      | [下方各章节](#passkey-认证配置)               | Passkey、API Token、速率限制、WebSocket、日志、HTTPS、防火墙 |

---

## Passkey 认证配置

### 基础配置

```dotenv
# Passkey Relying Party ID（域名，不带协议）
RP_ID=your-domain.com

# Passkey Relying Party Origin（完整 URL）
RP_ORIGIN=https://your-domain.com
```

### 多域名支持

一个 Passkey 跨多个独立域名使用：

```dotenv
RP_ID=your-domain.com
RP_ORIGIN=https://domain-a.com,https://domain-b.com
```

### WebAuthn 端点

检查 `/.well-known/webauthn` 是否可访问，该端点会自动配置。

## API Token 配置

```dotenv
# .env 文件中设置
REMOTE_GATEWAY_API_TOKEN=your-secure-token-here

# docker-compose.yml 中引用
remote-gateway:
  environment:
    REMOTE_GATEWAY_API_TOKEN: ${REMOTE_GATEWAY_API_TOKEN}
```

::: tip 建议

- 使用强随机字符串（建议 32+ 字符）
- Backend 和 Remote Gateway 需要使用相同 Token
  :::

## 速率限制

| 配置项     | 默认值  | 说明             |
| ---------- | ------- | ---------------- |
| 窗口时间   | 15 分钟 | 限制计数窗口     |
| 最大请求数 | 300 次  | 窗口内最大请求数 |
| 跳过条件   | 已认证  | 登录后不受限制   |

可通过环境变量调整：

```dotenv
# 通用 API
API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=300

# Settings API
SETTINGS_RATE_LIMIT_WINDOW_MS=900000
SETTINGS_RATE_LIMIT_MAX=500
```

## WebSocket 配置

### 心跳参数

```dotenv
HEARTBEAT_INTERVAL_DESKTOP=30000   # 桌面端心跳（毫秒）
HEARTBEAT_INTERVAL_MOBILE=12000    # 移动端心跳（毫秒）
MAX_MISSED_PONGS_DESKTOP=1         # 桌面端最大丢包次数
MAX_MISSED_PONGS_MOBILE=3          # 移动端最大丢包次数
```

### 多路复用

启用 WebSocket 多路复用，单个物理连接可承载多个 SSH 会话，减少浏览器连接数和服务器资源消耗。

```dotenv
ENABLE_MULTIPLEX=false             # 默认关闭，设为 true 启用
```

> 注意：多路复用模式下，多个终端标签共享同一个 WebSocket 连接。关闭时回退到传统的每会话一个连接模式。

### Nginx 超时

```nginx
location /ws/ {
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

## 日志配置

```dotenv
LOG_LEVEL=info   # debug | info | warn | error | silent
```

Docker 日志轮转（已在 `docker-compose.yml` 中配置）：

```yaml
logging:
  driver: json-file
  options:
    max-size: '10m'
    max-file: '3'
```

```bash
# 查看日志
docker compose logs -f backend
docker compose logs --tail 100 backend
```

## HTTPS 配置

生产环境强烈建议使用 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
}
```

## 防火墙

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 18111/tcp   # 不对外暴露直连端口
sudo ufw deny 3001/tcp    # 不对外暴露后端端口
```

## 故障排查

### 环境变量未生效

```bash
docker compose exec backend env | grep YOUR_VARIABLE
docker compose down && docker compose up -d
```

### 配置文件语法错误

```bash
docker compose config   # 测试 Docker Compose 配置
sudo nginx -t           # 测试 Nginx 配置
```

### 权限问题

```bash
ls -la data/
sudo chown -R 1000:1000 data/
```
