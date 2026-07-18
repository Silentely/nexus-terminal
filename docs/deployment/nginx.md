# Nginx 反向代理配置指南

> 本文档提供星枢终端（Nexus Terminal）的 Nginx 反向代理配置示例，涵盖多种部署场景。

---

## 目录

- [基础配置](#基础配置)
  - [最小化配置](#最小化配置)（本地开发）
  - [Docker 宿主机 Nginx 配置](#docker-宿主机-nginx-配置)（推荐）
  - [Docker Compose 内部 Nginx 说明](#docker-compose-内部-nginx-说明)
- [HTTPS/SSL 配置](#httpsssl-配置)
- [WebSocket 代理](#websocket-代理)
- [负载均衡](#负载均衡)
- [安全加固](#安全加固)
- [性能优化](#性能优化)
- [常见问题](#常见问题)

---

## 基础配置

### 最小化配置

适用于本地开发或内网环境：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 请求体大小限制（文件上传）
    client_max_body_size 100m;

    # 前端静态资源（如果前后端分离部署）
    location / {
        proxy_pass http://127.0.0.1:5173;  # Vite 开发服务器
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 连接（SSH 终端）
    location /ws/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;  # 24小时，保持长连接
        proxy_send_timeout 86400s;
    }

}
```

### Docker 宿主机 Nginx 配置

适用于 Docker Compose 部署 + 宿主机 Nginx 反向代理的场景（最常见）。

::: warning 架构说明仓库默认 `docker-compose.yml` 使用 `18111:8080`，便于首次通过 HTTP 直连验证服务。公网生产环境使用宿主机 Nginx 时，建议将前端端口改为 `127.0.0.1:18111:8080`，由宿主机 Nginx 作为唯一公网入口代理到 `18111`。前端容器内部的 nginx 代理 `/api/` 和 `/ws/` 到 backend，RDP/VNC 连接由 backend 通过内部 WebSocket 代理到 remote-gateway，无需单独配置远程桌面路径。:::

::: warning 代理头信任边界
宿主机 Nginx 必须用 `$scheme` 覆盖 `X-Forwarded-Proto`，前端容器只应接收来自宿主机或可信外层代理的流量。不要在公网直接暴露前端容器 HTTP 端口后再信任客户端传入的 `X-Forwarded-Proto`。
:::

```yaml
# docker-compose.yml（公网生产推荐）
services:
  frontend:
    ports:
      - '127.0.0.1:18111:8080'
```

```nginx
# WebSocket 连接映射（建议放在 http 块中）
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    client_max_body_size 100m;

    # 前端 + 后端 API + SSH 终端（通过前端容器代理）
    location / {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

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
}
```

### Docker Compose 内部 Nginx 说明

Docker 镜像已经内置前端 nginx 配置，对应源码为 `packages/frontend/nginx.conf`。普通 Docker Compose 部署不需要把这段配置复制到宿主机 Nginx；宿主机只需要按上一节代理到 `18111`。

内置 nginx 的当前行为：

- 监听容器内 `8080`，由 `docker-compose.yml` 映射到宿主机 `18111`。
- `location /` 提供前端静态资源，并通过 `try_files $uri $uri/ /index.html` 支持 SPA 路由。
- 静态资源设置 `Cache-Control: public, max-age=31536000, immutable`，并启用 `gzip_static`。
- `location ^~ /api/` 代理到 `http://backend:3001`，并把可信外层代理传入的 `X-Forwarded-Proto` 继续转发给 backend。
- `location /ws/` 代理到 `http://backend:3001`，用于 SSH 终端等 WebSocket 长连接。
- `/api/` 启用 `proxy_next_upstream error timeout http_502 http_503` 和 10 秒连接超时，用于缓解启动阶段 backend 尚未就绪的短暂 502/503。

::: warning 维护提示
如需自定义前端镜像内的 nginx，请以 `packages/frontend/nginx.conf` 为准。文档不再完整复制该文件，避免实际镜像配置更新后示例漂移。
:::

---

## HTTPS/SSL 配置

### Let's Encrypt 证书配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # ACME 验证
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # HTTP 重定向到 HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/your-domain.com/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;

    client_max_body_size 100m;

    # 前端 + 后端 API + SSH 终端（通过前端容器代理）
    location / {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:18111;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

### 自签名证书配置（内网/测试环境）

生成自签名证书：

```bash
# 生成私钥
openssl genrsa -out /etc/nginx/ssl/nexus.key 2048

# 生成证书
openssl req -new -x509 -key /etc/nginx/ssl/nexus.key \
    -out /etc/nginx/ssl/nexus.crt -days 3650 \
    -subj "/CN=nexus-terminal.local"
```

Nginx 配置：

```nginx
server {
    listen 443 ssl http2;
    server_name nexus-terminal.local;

    ssl_certificate /etc/nginx/ssl/nexus.crt;
    ssl_certificate_key /etc/nginx/ssl/nexus.key;

    # 其他配置同上...
}
```

---

## WebSocket 代理

### WebSocket 连接详解

星枢终端使用两种 WebSocket 连接：

| 路径   | 用途                              | 后端服务 | 默认端口 |
| ------ | --------------------------------- | -------- | -------- |
| `/ws/` | SSH 终端、SFTP、RDP/VNC、批量执行 | backend  | 3001     |

### WebSocket 专用配置

```nginx
# WebSocket 连接映射
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    # ... 基础配置 ...

    # SSH 终端 WebSocket
    location /ws/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # WebSocket 必需头
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # 客户端信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置（保持长连接）
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;

        # 禁用缓冲（实时数据）
        proxy_buffering off;
        proxy_cache off;

        # TCP 优化
        tcp_nodelay on;
    }
}
```

---

## 负载均衡

### 多实例后端负载均衡

```nginx
upstream nexus_backend_cluster {
    least_conn;  # 最少连接算法

    server 192.168.1.10:3001 weight=5;
    server 192.168.1.11:3001 weight=5;
    server 192.168.1.12:3001 weight=3 backup;

    keepalive 64;
}

server {
    listen 80;
    server_name your-domain.com;

    location /api/ {
        proxy_pass http://nexus_backend_cluster;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        # ... 其他头 ...
    }

    location /ws/ {
        proxy_pass http://nexus_backend_cluster;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # ... 其他配置 ...
    }
}
```

### 健康检查（Nginx Plus 或 OpenResty）

```nginx
upstream nexus_backend_cluster {
    zone backend_zone 64k;

    server 192.168.1.10:3001;
    server 192.168.1.11:3001;

    # 健康检查（需要 Nginx Plus）
    health_check interval=5s fails=3 passes=2;
}
```

---

## 安全加固

### 安全头配置

::: warning 避免重复安全头
当使用 Nginx 反向代理时，Express 后端和 Nginx 会同时设置安全响应头（CSP、X-Frame-Options 等），导致重复。

**推荐方案**：在 `.env` 中设置 `BEHIND_REVERSE_PROXY=true`，让 Express 跳过安全头设置，由 Nginx 统一管理。

**备选方案**：使用 `proxy_hide_header` 指令清除上游响应中的安全头，由 Nginx 重新设置（见下方"清除上游头"章节）。

**注意**：重复的 `Content-Security-Policy` 头会被浏览器取交集（AND），可能导致合法资源被阻止加载。
:::

::: tip CAPTCHA 与 CSP
登录页会动态加载 Google reCAPTCHA / hCaptcha 脚本。若 CSP 未放行对应域名，浏览器会报
`Loading the script 'https://www.google.com/recaptcha/api.js' violates Content Security Policy`，验证码无法显示。
下方示例与后端 Helmet CSP（`packages/backend/src/config/middleware.ts`）对齐；使用 Cloudflare 等额外安全头时同样需要放行这些域。
:::

```nginx
server {
    # ... SSL 配置 ...

    # 安全响应头（当 BEHIND_REVERSE_PROXY=true 时由 Nginx 独立管理）
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # 注意：须包含 reCAPTCHA/hCaptcha/Cloudflare Insights/Google Fonts，否则登录验证码或字体可能被拦截
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://cdn-cgi.cloudflare.com https://www.google.com https://www.gstatic.com https://hcaptcha.com https://js.hcaptcha.com https://newassets.hcaptcha.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://www.gstatic.com https://*.google.com https://hcaptcha.com https://js.hcaptcha.com https://newassets.hcaptcha.com; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' wss: ws: https://static.cloudflareinsights.com https://cdn-cgi.cloudflare.com https://www.google.com https://www.gstatic.com https://hcaptcha.com https://js.hcaptcha.com https://newassets.hcaptcha.com; frame-src 'self' https://www.google.com https://www.gstatic.com https://hcaptcha.com https://js.hcaptcha.com https://newassets.hcaptcha.com https://*.hcaptcha.com;" always;

    # HSTS（仅 HTTPS）
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 限制浏览器特性访问
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;

    # 隐藏 Nginx 版本
    server_tokens off;

    # ... 其他配置 ...
}
```

### 清除上游安全头（备选方案）

如果不想修改 Express 配置（不设置 `BEHIND_REVERSE_PROXY`），可以在 Nginx 中使用 `proxy_hide_header` 清除上游响应的安全头，然后由 Nginx 重新设置：

```nginx
location / {
    proxy_pass http://127.0.0.1:18111;

    # 清除上游（Express）设置的安全头，由 Nginx 统一管理
    proxy_hide_header Content-Security-Policy;
    proxy_hide_header X-Frame-Options;
    proxy_hide_header X-Content-Type-Options;
    proxy_hide_header Referrer-Policy;
    proxy_hide_header Strict-Transport-Security;
    proxy_hide_header Permissions-Policy;
    proxy_hide_header Cross-Origin-Opener-Policy;
    proxy_hide_header Cross-Origin-Resource-Policy;

    # Nginx 重新设置安全头（在 server 块中用 add_header）
    # ...
}
```

### 访问限制

```nginx
# 限制请求速率
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=ws_limit:10m rate=5r/s;

# IP 白名单
geo $allowed_ip {
    default 0;
    192.168.0.0/16 1;
    10.0.0.0/8 1;
    # 添加更多允许的 IP 段
}

server {
    # ... 基础配置 ...

    # API 限速
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;

        # 可选：IP 白名单
        # if ($allowed_ip = 0) {
        #     return 403;
        # }

        proxy_pass http://127.0.0.1:3001;
        # ... 其他配置 ...
    }

    # WebSocket 限速
    location /ws/ {
        limit_req zone=ws_limit burst=10 nodelay;
        proxy_pass http://127.0.0.1:3001;
        # ... 其他配置 ...
    }

    # 禁止访问敏感文件
    location ~ /\. {
        deny all;
    }

    location ~* \.(env|git|sql|bak)$ {
        deny all;
    }
}
```

### 基于 IP 的访问控制

```nginx
server {
    # 仅允许内网访问
    allow 192.168.0.0/16;
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    deny all;

    # ... 其他配置 ...
}
```

---

## 性能优化

### Gzip 压缩

```nginx
http {
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1000;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml
        application/xml+rss
        application/x-javascript
        image/svg+xml;
}
```

### 静态资源缓存

```nginx
server {
    # 前端静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # HTML 不缓存（SPA 路由）
    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
}
```

### 连接优化

```nginx
http {
    # 连接超时
    keepalive_timeout 65;
    keepalive_requests 1000;

    # 缓冲区大小
    client_body_buffer_size 128k;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 32k;

    # 代理缓冲
    proxy_buffer_size 4k;
    proxy_buffers 8 32k;
    proxy_busy_buffers_size 64k;

    # 文件传输优化
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
}
```

---

## 常见问题

### Q1: WebSocket 连接频繁断开

**原因**：超时设置过短或中间代理/防火墙断开空闲连接。

**解决方案**：

```nginx
location /ws/ {
    # 增加超时时间
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;

    # 确保正确的 WebSocket 头
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

同时检查：

- 云服务商负载均衡器的空闲超时设置
- 防火墙连接跟踪超时

### Q2: 502 Bad Gateway 错误

**原因**：后端服务未启动或代理配置错误。

**排查步骤**：

```bash
# 1. 检查后端服务
curl -v http://127.0.0.1:3001/api/v1/status

# 2. 检查 Nginx 错误日志
tail -f /var/log/nginx/error.log

# 3. 检查 upstream 配置
nginx -t
```

### Q3: 文件上传失败

**原因**：`client_max_body_size` 限制。

**解决方案**：

```nginx
server {
    client_max_body_size 100m;  # 调整为合适的大小

    location /api/ {
        # 大文件上传超时
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

### Q4: CORS 跨域问题

**解决方案**：

```nginx
location /api/ {
    # CORS 头（如果后端未处理）
    add_header Access-Control-Allow-Origin $http_origin always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With" always;
    add_header Access-Control-Allow-Credentials "true" always;

    # 预检请求
    if ($request_method = OPTIONS) {
        return 204;
    }

    proxy_pass http://127.0.0.1:3001;
}
```

---

## 完整配置示例

### 生产环境推荐配置

```nginx
# /etc/nginx/nginx.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml;

    # 限速
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

    # WebSocket 映射
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    # Upstream
    upstream nexus_frontend {
        server 127.0.0.1:18111;
        keepalive 32;
    }

    upstream nexus_backend {
        server 127.0.0.1:3001;
        keepalive 32;
    }

    include /etc/nginx/conf.d/*.conf;
}
```

```nginx
# /etc/nginx/conf.d/nexus-terminal.conf
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    client_max_body_size 100m;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;

    # 前端（Docker 部署时前端容器监听 80 端口，通过 upstream 名称访问）
    location / {
        proxy_pass http://nexus_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API（转发到后端服务）
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://nexus_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }

    # SSH WebSocket
    location /ws/ {
        proxy_pass http://nexus_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }
}
```

---

**文档更新时间**：2026-05-19
