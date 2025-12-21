# Remote Gateway CORS 配置说明

## 概述

Remote Gateway 服务支持灵活的 CORS（跨域资源共享）配置，可以通过环境变量控制哪些域名可以访问远程桌面网关。

---

## 环境变量

### 1. `CORS_ALLOWED_ORIGINS`
**类型**: 字符串（逗号分隔）
**默认值**: 空
**描述**: 额外允许的 CORS 来源，支持多个域名（逗号分隔）

**示例**:
```env
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,https://admin.yourdomain.com
```

### 2. `CORS_ALLOW_ALL`
**类型**: 布尔值（`true` 或 `false`）
**默认值**: `false`
**描述**: 是否允许所有来源访问（仅用于开发环境，**生产环境强烈不推荐**）

**示例**:
```env
CORS_ALLOW_ALL=true  # ⚠️ 仅用于开发/测试
```

### 3. `FRONTEND_URL` 和 `MAIN_BACKEND_URL`
**类型**: 字符串（URL）
**默认值**:
- `FRONTEND_URL`: `http://localhost:5173`
- `MAIN_BACKEND_URL`: `http://localhost:3000`

**描述**: 默认允许的前端和后端 URL，始终会被添加到 CORS 白名单

---

## 配置示例

### Docker Compose 配置

编辑 `docker-compose.yml` 文件中的 `remote-gateway` 服务：

```yaml
remote-gateway:
  image: nexus-terminal-remote-gateway:latest
  environment:
    GUACD_HOST: guacd
    GUACD_PORT: 4822
    FRONTEND_URL: http://frontend
    MAIN_BACKEND_URL: http://backend:3001

    # 添加额外的允许域名
    CORS_ALLOWED_ORIGINS: https://yourdomain.com,https://www.yourdomain.com

    # 开发模式（可选，不推荐生产使用）
    # CORS_ALLOW_ALL: true
```

### 本地开发配置

创建或编辑 `.env` 文件：

```env
FRONTEND_URL=http://localhost:5173
MAIN_BACKEND_URL=http://localhost:3001
CORS_ALLOWED_ORIGINS=http://localhost:8080
CORS_ALLOW_ALL=false
```

---

## 常见问题

### Q1: 浏览器控制台显示 CORS 错误怎么办？

**情况 1: 错误域名不是你的应用**

如果看到类似 `keylol.cloudflareaccess.com` 或 `ssh.cosr.eu` 的域名：
- ✅ 这些错误**不是来自你的应用代码**
- ✅ 通常是浏览器扩展、广告拦截器或代理软件尝试加载资源
- ✅ 这些错误**不影响应用功能**，可以安全忽略

**排查方法**:
1. 在无痕窗口中测试（禁用所有扩展）
2. 禁用广告拦截器（如 uBlock Origin、AdGuard）
3. 检查 VPN 或代理软件

**情况 2: 错误域名是你的应用**

如果看到自己的域名被 CORS 拦截：
1. 检查 `docker-compose.yml` 中的 `FRONTEND_URL` 和 `MAIN_BACKEND_URL` 是否正确
2. 如需支持额外域名，配置 `CORS_ALLOWED_ORIGINS`
3. 重启 remote-gateway 服务：`docker-compose restart remote-gateway`

### Q2: 为什么我的自定义域名访问不了？

确保在 `CORS_ALLOWED_ORIGINS` 中添加了你的域名：

```yaml
environment:
  CORS_ALLOWED_ORIGINS: https://terminal.example.com,https://www.example.com
```

注意：
- ✅ 包含协议（`http://` 或 `https://`）
- ✅ 不要添加尾部斜杠
- ✅ 多个域名用逗号分隔，不要有空格

### Q3: 开发时能临时允许所有来源吗？

可以，但**仅限开发环境**：

```yaml
environment:
  CORS_ALLOW_ALL: true  # ⚠️ 生产环境禁用！
```

生产环境**必须明确配置允许的域名**，不能使用 `CORS_ALLOW_ALL=true`。

---

## 安全建议

1. **最小权限原则**: 仅允许必要的域名访问
2. **生产环境**: 禁用 `CORS_ALLOW_ALL`
3. **HTTPS**: 生产环境使用 HTTPS 协议
4. **定期审查**: 定期检查允许的域名列表

---

## 日志示例

### 正常启动日志

```
[Remote Gateway] CORS 允许的来源: http://frontend, http://backend:3001, https://yourdomain.com
```

### 开发模式日志

```
[Remote Gateway] ⚠️ CORS 允许所有来源（开发模式）
```

---

## 更多信息

- [CORS MDN 文档](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS)
- [Guacamole 官方文档](https://guacamole.apache.org/)
