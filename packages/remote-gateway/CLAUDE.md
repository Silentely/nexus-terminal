# Remote Gateway Module - @nexus-terminal/remote-gateway

> [← 返回根文档](../../CLAUDE.md) | **packages/remote-gateway**

---

## 变更记录 (Changelog)

### 2025-12-20 22:27:42
- **初始化模块文档**：完成远程网关模块架构分析与文档建立
- **核心功能**：RDP/VNC 协议代理，基于 Guacamole Lite
- **API 端点**：识别 1 个令牌生成端点
- **覆盖率**：模块文档初始化完成

---

## 模块概述

**@nexus-terminal/remote-gateway** 是星枢终端的远程桌面网关服务，基于 [guacamole-lite](https://www.npmjs.com/package/guacamole-lite) 构建，提供：
- RDP (Remote Desktop Protocol) 连接代理
- VNC (Virtual Network Computing) 连接代理
- 安全的令牌加密机制
- WebSocket 到 Guacamole 协议转换

---

## 技术栈

| 类别 | 技术/库 |
|------|---------|
| 运行时 | Node.js |
| 框架 | Express 5.x |
| 语言 | TypeScript 5.x |
| 远程桌面 | guacamole-lite 0.7.x |
| WebSocket | ws (由 guacamole-lite 管理) |
| 加密 | Node.js crypto (AES-256-CBC) |
| 跨域 | cors |

---

## 架构概述

```
                                      ┌─────────────────────────────────────┐
                                      │         Remote Gateway               │
                                      │                                     │
┌──────────────┐    HTTP POST         │  ┌─────────────────────────────┐   │
│   Frontend   │ ──────────────────── │  │    Express API Server       │   │
│              │   /api/remote-       │  │    (Port 9090)              │   │
│              │   desktop/token      │  │                             │   │
└──────────────┘                      │  │  • 接收连接参数             │   │
       │                              │  │  • 加密生成令牌             │   │
       │ WebSocket                    │  │  • 返回加密 Token           │   │
       │ (with token)                 │  └─────────────────────────────┘   │
       │                              │                                     │
       ▼                              │  ┌─────────────────────────────┐   │
┌──────────────┐    Guacamole WS      │  │    GuacamoleLite Server     │   │
│   Browser    │ ──────────────────── │  │    (Port 8080)              │   │
│  guacamole-  │                      │  │                             │   │
│  common-js   │                      │  │  • 解密验证 Token           │   │
└──────────────┘                      │  │  • 建立 Guacd 连接          │   │
                                      │  │  • 协议转换与转发           │   │
                                      │  └──────────────┬──────────────┘   │
                                      │                 │                   │
                                      └─────────────────│───────────────────┘
                                                        │
                                                        │ TCP
                                                        ▼
                                      ┌─────────────────────────────────────┐
                                      │              Guacd                   │
                                      │         (Port 4822)                  │
                                      │                                     │
                                      │  • RDP/VNC 协议实现                 │
                                      │  • 连接目标服务器                   │
                                      └─────────────────────────────────────┘
                                                        │
                                                        │ RDP/VNC
                                                        ▼
                                      ┌─────────────────────────────────────┐
                                      │         Target Server               │
                                      │    (Windows RDP / VNC Server)       │
                                      └─────────────────────────────────────┘
```

---

## 目录结构

```
packages/remote-gateway/
├── src/
│   └── server.ts                   # 服务入口（API + Guacamole）
│
├── guacamole-lite.d.ts             # TypeScript 类型声明
├── Dockerfile                      # Docker 构建配置
├── tsconfig.json                   # TypeScript 配置
└── package.json                    # 包配置
```

---

## API 端点

### POST `/api/remote-desktop/token`

生成加密的远程桌面连接令牌。

**请求体：**
```json
{
  "protocol": "rdp" | "vnc",
  "connectionConfig": {
    "hostname": "string",      // 目标主机地址
    "port": "string",          // 目标端口
    "username": "string",      // 用户名 (RDP 必需, VNC 可选)
    "password": "string",      // 密码 (必需)
    "width": "number",         // 分辨率宽度 (默认 1024)
    "height": "number",        // 分辨率高度 (默认 768)
    "dpi": "number",           // DPI (RDP, 默认 96)
    "security": "string",      // 安全模式 (RDP, 默认 "any")
    "ignoreCert": "boolean"    // 忽略证书 (RDP, 默认 true)
  }
}
```

**响应：**
```json
{
  "token": "encrypted-base64-token"
}
```

**错误响应：**
```json
{
  "error": "错误描述"
}
```

---

## 加密机制

### 令牌加密流程

1. **密钥生成**：服务启动时生成随机 32 字节 AES-256 密钥（仅存于内存）
2. **数据准备**：将连接参数序列化为 JSON
3. **AES 加密**：使用 AES-256-CBC 模式加密
4. **令牌格式**：Base64 编码的 JSON，包含 IV 和密文

```typescript
// 令牌结构
{
  "iv": "base64-encoded-iv",
  "value": "base64-encoded-ciphertext"
}
```

### 安全特性
- **一次性密钥**：每次服务重启生成新密钥，旧令牌自动失效
- **随机 IV**：每个令牌使用独立的初始化向量
- **无持久化**：密钥不写入磁盘，仅存于进程内存

---

## 关键文件清单

### 入口文件
- `src/server.ts` - 唯一源文件，包含：
  - Express API 服务器配置
  - GuacamoleLite 服务初始化
  - 令牌加密逻辑
  - 优雅关闭处理

### 配置文件
- `guacamole-lite.d.ts` - guacamole-lite 的 TypeScript 类型声明
- `Dockerfile` - Docker 构建配置

---

## 环境变量

| 变量名 | 默认值 | 描述 |
|-------|--------|-----|
| `REMOTE_GATEWAY_WS_PORT` | 8080 | Guacamole WebSocket 端口 |
| `REMOTE_GATEWAY_API_PORT` | 9090 | API 服务端口 |
| `GUACD_HOST` | localhost | Guacd 服务地址 |
| `GUACD_PORT` | 4822 | Guacd 服务端口 |
| `FRONTEND_URL` | http://localhost:5173 | 前端 URL（CORS 白名单） |
| `MAIN_BACKEND_URL` | http://localhost:3000 | 后端 URL（CORS 白名单） |

---

## 运行命令

```bash
# 开发模式（nodemon 热重载）
npm run dev

# 构建生产版本
npm run build

# 启动生产服务
npm start
```

---

## 依赖说明

### 运行时依赖

| 包名 | 版本 | 用途 |
|-----|------|-----|
| guacamole-lite | ^0.7.3 | Guacamole 协议服务器 |
| express | ^5.1.0 | HTTP API 框架 |
| ws | ^8.18.1 | WebSocket 库 |
| cors | ^2.8.5 | 跨域资源共享 |

### 外部依赖

| 服务 | 说明 |
|-----|------|
| **Guacd** | Apache Guacamole 守护进程，处理实际的 RDP/VNC 协议 |

---

## 与其他模块的交互

### 调用方：Backend
- 后端可能调用 `/api/remote-desktop/token` 获取令牌
- 令牌用于前端建立 WebSocket 连接

### 调用方：Frontend
- 前端通过 `guacamole-common-js` 库连接 WebSocket
- 传递令牌进行身份验证
- 接收并渲染远程桌面画面

### 依赖：Guacd
- 必须运行 Guacd 服务（Docker 部署时通过 `guacamole/guacd` 镜像）
- 通过 TCP 连接 Guacd 进行协议转换

---

## Docker 部署

### 单独构建
```bash
docker build -t nexus-terminal-remote-gateway .
docker run -p 8080:8080 -p 9090:9090 \
  -e GUACD_HOST=guacd \
  -e GUACD_PORT=4822 \
  nexus-terminal-remote-gateway
```

### Docker Compose（推荐）
参见根目录 `docker-compose.yml`，remote-gateway 作为独立服务运行，与 guacd 服务通过 Docker 网络通信。

---

## 常见问题 (FAQ)

### Q: 为什么每次重启后旧的远程桌面连接失效？
加密密钥在服务启动时生成并仅存于内存。重启后生成新密钥，旧令牌无法解密。

### Q: 如何调试 RDP/VNC 连接问题？
1. 检查 Guacd 服务是否正常运行：`docker logs guacd`
2. 检查 Remote Gateway 日志：查看连接事件和错误
3. 确认目标服务器的 RDP/VNC 服务已启用

### Q: 支持哪些 RDP 安全模式？
通过 `security` 参数配置，支持：
- `any`（默认，自动协商）
- `nla`（网络级别身份验证）
- `tls`
- `rdp`

### Q: VNC 认证如何工作？
VNC 主要使用密码认证，`username` 字段可选。部分 VNC 服务器可能需要用户名。

---

**文档生成时间**：2025-12-20 22:27:42
