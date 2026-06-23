# WebSocket 多路复用协议规范

## 概述

多路复用模式允许单个物理 WebSocket 连接承载多个逻辑 SSH 会话通道。通过消息中的 `sid`（Session ID）字段实现路由。

## 连接建立

### 物理连接

- **协议头**：`Sec-WebSocket-Protocol: nexus-mux`
- **端点**：`ws(s)://<host>/ws/`
- **认证**：与普通 WebSocket 相同（Cookie / Token）

### 逻辑通道

1. 客户端发送 `ssh:connect` 消息，携带 `sid` 字段标识逻辑通道
2. 服务端创建 SSH 连接，生成后端 `sessionId`（UUID）
3. 服务端返回 `ssh:connected`，携带后端 `sessionId` 作为 `sid`
4. 后续所有该通道的消息均使用后端 `sessionId` 作为 `sid`

## 消息格式

### 客户端 → 服务端

```json
{
  "type": "ssh:input",
  "sid": "<session-id>",
  "payload": "<terminal-input-data>"
}
```

### 服务端 → 客户端

```json
{
  "type": "ssh:output",
  "sid": "<session-id>",
  "payload": "<base64-encoded-terminal-output>",
  "encoding": "base64"
}
```

## 消息类型与 sid 支持

| 消息类型                 | 方向 | sid | 说明                 |
| ------------------------ | ---- | --- | -------------------- |
| `ssh:connect`            | C→S  | ✅  | 客户端生成的初始 sid |
| `ssh:connected`          | S→C  | ✅  | 后端 sessionId       |
| `ssh:input`              | C→S  | ✅  | 后端 sessionId       |
| `ssh:output`             | S→C  | ✅  | 后端 sessionId       |
| `ssh:resize`             | C→S  | ✅  | 后端 sessionId       |
| `ssh:status`             | S→C  | ✅  | 当前会话 sessionId   |
| `ssh:error`              | S→C  | ✅  | 当前会话 sessionId   |
| `ssh:disconnected`       | S→C  | ✅  | 后端 sessionId       |
| `ssh:exec_silent`        | C→S  | ✅  | 后端 sessionId       |
| `ssh:exec_silent:result` | S→C  | ✅  | 后端 sessionId       |
| `ssh:exec_silent:error`  | S→C  | ✅  | 后端 sessionId       |
| `ssh:route_plan`         | S→C  | ✅  | 后端 sessionId       |
| `sftp_ready`             | S→C  | ✅  | 后端 sessionId       |
| `sftp:*`                 | C→S  | ✅  | 后端 sessionId       |
| `docker:*`               | C→S  | ✅  | 后端 sessionId       |

## 后端路由逻辑

```
收到消息 → 提取 sid
  ├─ 多路复用模式且 sid 存在
  │   ├─ 校验 sid 对应的会话属于当前用户 → 使用 sid 作为 effectiveSessionId
  │   ├─ 会话存在但不属于当前用户 → 拒绝，返回 error
  │   └─ 会话不存在 → 拒绝，返回 error
  └─ 非多路复用模式或 sid 缺失
      └─ 使用 ws.sessionId 作为 effectiveSessionId
```

## 前端路由逻辑

```
收到消息 → 提取 sid
  ├─ sid 存在且匹配已知通道 → 分发到通道的消息处理器
  ├─ sid 存在但通道未知 → 忽略，打印警告
  └─ sid 缺失 → 忽略，打印警告
```

## 环境变量

| 变量                    | 层级 | 默认值  | 说明             |
| ----------------------- | ---- | ------- | ---------------- |
| `ENABLE_MULTIPLEX` | 后端 | `false` | 启用多路复用（前端通过 `/auth/init` 接口自动跟随，无需额外配置） |

## 限制

- 仅 SSH 会话支持多路复用
- RDP/VNC 会话仍使用独立连接
- 物理连接断开时所有通道同时断开
- 自动重连最多 5 次，指数退避
