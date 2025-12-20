# 星枢终端（Nexus Terminal）功能发展规划

> 基于 [next-terminal](https://github.com/dushixiang/next-terminal) 等优秀开源项目的功能分析，制定的产品发展路线图

**创建时间**：2025-12-20
**状态**：规划中

---

## 目录

- [功能对比矩阵](#功能对比矩阵)
- [P0 - 核心竞争力功能](#p0---核心竞争力功能)
- [P1 - 企业级增强功能](#p1---企业级增强功能)
- [P2 - 生态扩展功能](#p2---生态扩展功能)
- [实施路线图](#实施路线图)
- [技术建议](#技术建议)
- [参考资料](#参考资料)

---

## 功能对比矩阵

| 功能领域 | Next Terminal | Nexus Terminal (当前) | 差距分析 |
|---------|--------------|----------------------|---------|
| **协议支持** | SSH/RDP/VNC/Telnet/K8s/HTTP | SSH/SFTP/RDP/VNC | 缺少 Telnet、K8s |
| **会话录像** | ✅ 录像+回放 | ❌ 无 | **重要缺失** |
| **实时监控** | ✅ 监控+阻断 | ❌ 无 | **重要缺失** |
| **命令拦截** | ✅ 高危命令拦截 | ❌ 无 | 安全增强 |
| **资产分组** | ✅ 分组+标签 | ⚠️ 仅标签 | 需增强 |
| **凭证管理** | ✅ 独立凭证库 | ⚠️ 内嵌于连接 | 需重构 |
| **授权策略** | ✅ 用户组+策略 | ⚠️ 简单权限 | 需增强 |
| **批量执行** | ✅ 批量命令 | ❌ 无 | 运维效率 |
| **计划任务** | ✅ Cron 任务 | ❌ 无 | 自动化 |
| **双因素认证** | ✅ TOTP | ✅ TOTP + Passkey | **领先** |
| **文件传输策略** | ✅ 精细控制 | ⚠️ 基础功能 | 需增强 |
| **审计日志** | ✅ 完整 | ✅ 完整 | 相当 |
| **LDAP/SSO** | ✅ LDAP | ❌ 无 | 企业场景 |
| **仪表盘** | ✅ 丰富 | ⚠️ 基础 | 需增强 |
| **终端定制** | ⚠️ 基础 | ✅ 高度定制 | **领先** |
| **会话挂起** | ❌ 无 | ✅ SSH 会话挂起 | **领先** |
| **Docker 管理** | ❌ 无 | ✅ 容器管理 | **领先** |

### 星枢终端的独特优势

- ✨ **SSH 会话挂起与恢复** - 断网不丢会话，随时恢复
- ✨ **高度可定制的终端主题与布局** - 个性化工作空间
- ✨ **Docker 容器管理集成** - 一站式运维
- ✨ **Passkey 无密码认证** - 现代化安全体验
- ✨ **轻量级 Node.js 架构** - 资源占用低

---

## P0 - 核心竞争力功能

> 建议 1-3 个月内实现，企业级运维审计的核心需求

### 1. 会话录像与回放系统

**优先级**：🔴 最高
**预估工期**：2 个月

#### 功能描述

- 自动录制所有 SSH/RDP/VNC 会话
- 支持录像回放，可调节播放速度
- 录像文件压缩存储，支持本地/对象存储
- 录像搜索与筛选（按用户、连接、时间范围）

#### 实现思路

- **SSH 会话**：在 WebSocket 层拦截终端数据流，按时间戳存储为 asciinema 格式
- **RDP/VNC 会话**：利用 Guacamole 的录制能力，存储为视频格式
- **存储方案**：本地文件 + 可选 S3/MinIO 对象存储
- **回放器**：前端实现 asciinema-player 集成 + 视频播放器

#### 数据表设计

```sql
CREATE TABLE session_recordings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    protocol TEXT NOT NULL,  -- ssh/rdp/vnc
    file_path TEXT NOT NULL,
    file_size INTEGER,
    duration INTEGER,  -- 秒
    started_at DATETIME,
    ended_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recordings_user ON session_recordings(user_id);
CREATE INDEX idx_recordings_connection ON session_recordings(connection_id);
CREATE INDEX idx_recordings_time ON session_recordings(started_at);
```

#### 涉及模块

| 模块 | 路径 | 描述 |
|-----|------|-----|
| 后端服务 | `backend/src/session-recording/` | 录像存储与管理服务 |
| 前端组件 | `frontend/src/components/SessionPlayer.vue` | 回放播放器组件 |
| 前端页面 | `frontend/src/views/RecordingsView.vue` | 录像列表与管理页 |

---

### 2. 实时会话监控与管理

**优先级**：🔴 最高
**预估工期**：1 个月

#### 功能描述

- 实时展示所有活跃会话列表
- 管理员可"旁观"任意 SSH 会话（只读模式）
- 支持强制断开指定会话
- 可选：协同操作模式（管理员接管会话）

#### 实现思路

```
用户终端 ←→ WebSocket ←→ 后端 SSH 代理 ←→ 远程服务器
                ↓
        管理员监控 WebSocket（只读分发）
```

- 后端维护活跃会话注册表
- 监控订阅机制：管理员订阅指定会话 ID
- 数据分发：终端数据同时发送给用户和监控者
- 权限控制：仅管理员可访问监控功能

#### 涉及模块

| 模块 | 路径 | 描述 |
|-----|------|-----|
| 后端服务 | `backend/src/session-monitor/` | 会话监控服务 |
| 前端页面 | `frontend/src/views/SessionMonitorView.vue` | 监控面板 |
| 前端组件 | `frontend/src/components/SessionViewer.vue` | 会话查看器（只读终端） |

---

### 3. 命令拦截器（高危命令防护）

**优先级**：🔴 高
**预估工期**：1 个月

#### 功能描述

- 基于正则表达式的命令匹配规则
- 拦截动作：阻断 / 警告 / 仅记录 / 需审批
- 内置常见高危命令规则（rm -rf、shutdown、reboot、dd 等）
- 支持自定义规则，按连接/标签/全局生效

#### 数据表设计

```sql
CREATE TABLE command_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,  -- 正则表达式
    action TEXT NOT NULL,   -- block/warn/log/approve
    severity TEXT DEFAULT 'high',  -- low/medium/high/critical
    enabled INTEGER DEFAULT 1,
    scope TEXT DEFAULT 'global',  -- global/connection/tag
    scope_id TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE command_intercepts (
    id TEXT PRIMARY KEY,
    rule_id TEXT REFERENCES command_rules(id),
    session_id TEXT,
    user_id TEXT,
    connection_id TEXT,
    command TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    approved_by TEXT,
    approved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 预设规则示例

| 规则名称 | 正则模式 | 动作 | 严重程度 |
|---------|---------|-----|---------|
| 危险删除 | `rm\s+(-[rf]+\s+)*(/\|~)` | block | critical |
| 系统关机 | `(shutdown\|poweroff\|halt\|init\s+0)` | block | critical |
| 系统重启 | `(reboot\|init\s+6)` | warn | high |
| 磁盘写入 | `dd\s+.*of=` | warn | high |
| 格式化 | `mkfs\.\w+` | block | critical |
| 权限修改 | `chmod\s+777` | warn | medium |
| 防火墙 | `(iptables\|firewall-cmd).*(-F\|--flush)` | block | high |

---

## P1 - 企业级增强功能

> 建议 3-6 个月内实现，提升企业场景适用性

### 4. 凭证管理中心

**优先级**：🟠 高
**预估工期**：1 个月

#### 功能描述

- 独立的凭证存储库（密码、SSH 密钥、证书）
- 连接配置引用凭证，而非内嵌
- 凭证更新自动应用到所有关联连接
- 凭证使用审计

#### 当前问题

- 凭证嵌入在连接配置中
- 同一凭证需要在多个连接中重复配置
- 凭证更新需要修改所有相关连接
- 无法实现凭证轮换策略

#### 数据表设计

```sql
CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- password/ssh_key/certificate
    username TEXT,
    encrypted_password TEXT,
    ssh_key_id TEXT REFERENCES ssh_keys(id),
    certificate_data TEXT,
    description TEXT,
    tags TEXT,  -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 修改 connections 表，添加凭证引用
ALTER TABLE connections ADD COLUMN credential_id TEXT REFERENCES credentials(id);
```

---

### 5. 资产分组与树形管理

**优先级**：🟠 高
**预估工期**：1 个月

#### 功能描述

- 多级分组（如：机房A / 生产环境 / Web服务器）
- 拖拽排序与分组调整
- 分组批量操作
- 分组权限继承

#### 数据表设计

```sql
CREATE TABLE connection_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES connection_groups(id),
    sort_order INTEGER DEFAULT 0,
    icon TEXT,
    color TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_groups_parent ON connection_groups(parent_id);

-- 修改 connections 表，添加分组引用
ALTER TABLE connections ADD COLUMN group_id TEXT REFERENCES connection_groups(id);
```

#### 前端实现

- 使用 Element Plus Tree 组件
- 支持拖拽排序（vuedraggable）
- 懒加载大量连接

---

### 6. 批量命令执行

**优先级**：🟠 中
**预估工期**：1 个月

#### 功能描述

- 按分组/标签/手动勾选选择目标主机
- 命令模板支持变量替换
- 可配置并行执行数
- 执行结果汇总与导出
- 超时与错误处理

#### 命令模板变量

| 变量 | 描述 | 示例 |
|-----|------|-----|
| `${host}` | 主机名 | server-01 |
| `${ip}` | IP 地址 | 192.168.1.100 |
| `${port}` | 端口号 | 22 |
| `${timestamp}` | 当前时间戳 | 1703030400 |
| `${date}` | 当前日期 | 2025-12-20 |
| `${user}` | 当前用户 | admin |

#### 涉及模块

| 模块 | 路径 | 描述 |
|-----|------|-----|
| 后端服务 | `backend/src/batch-execution/` | 批量执行服务 |
| 前端页面 | `frontend/src/views/BatchExecutionView.vue` | 批量执行界面 |
| 前端组件 | `frontend/src/components/ExecutionResultPanel.vue` | 结果展示面板 |

---

### 7. 计划任务（Cron Job）

**优先级**：🟠 中
**预估工期**：1 个月

#### 功能描述

- 任务类型：命令执行 / 脚本执行 / 文件同步
- 调度方式：Cron 表达式 / 固定间隔 / 单次定时
- 执行日志保存
- 失败告警与重试策略

#### 数据表设计

```sql
CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- command/script/sync
    cron_expression TEXT,
    interval_seconds INTEGER,
    run_once_at DATETIME,
    target_connections TEXT NOT NULL,  -- JSON array of connection IDs
    command TEXT,
    script_content TEXT,
    timeout_seconds INTEGER DEFAULT 300,
    retry_count INTEGER DEFAULT 0,
    retry_interval INTEGER DEFAULT 60,
    enabled INTEGER DEFAULT 1,
    last_run_at DATETIME,
    last_run_status TEXT,
    next_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_executions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES scheduled_tasks(id),
    status TEXT NOT NULL,  -- pending/running/success/failed/timeout
    started_at DATETIME,
    finished_at DATETIME,
    target_connection_id TEXT,
    output TEXT,
    error TEXT,
    exit_code INTEGER
);

CREATE INDEX idx_executions_task ON task_executions(task_id);
CREATE INDEX idx_executions_status ON task_executions(status);
```

---

## P2 - 生态扩展功能

> 建议 6-12 个月内实现，扩展产品生态

### 8. LDAP/SSO 集成

**优先级**：🟡 中
**预估工期**：2 个月

#### 支持协议

- LDAP / Active Directory
- OAuth 2.0 / OpenID Connect（Google、GitHub、GitLab 等）
- SAML 2.0

#### 实现要点

- 用户自动同步与映射
- 组织架构同步
- 单点登录与登出
- 本地账户与外部账户关联

---

### 9. Kubernetes 终端支持

**优先级**：🟡 中
**预估工期**：2 个月

#### 功能描述

- 连接 K8s 集群（kubeconfig / ServiceAccount / In-Cluster）
- 浏览 Namespace、Deployment、Pod
- Pod 终端（kubectl exec）
- Pod 日志查看（kubectl logs）
- 支持多集群管理

#### 技术方案

- 使用 @kubernetes/client-node 库
- WebSocket 代理 exec API
- 前端复用现有终端组件

---

### 10. Telnet 协议支持

**优先级**：🟡 低
**预估工期**：2 周

#### 说明

- 兼容老旧网络设备（路由器、交换机）
- 安全警告提示（明文传输风险）
- 可选禁用此协议

---

### 11. SSH 跳板机模式（SSH Server）

**优先级**：🟡 低
**预估工期**：1 个月

#### 功能描述

- 星枢终端本身作为 SSH Server 运行
- 用户通过标准 SSH 客户端连接
- 登录后展示可访问的资产列表
- 选择资产后自动建立连接

#### 使用场景

- 无法使用 Web 浏览器的场景
- 与现有 SSH 工作流集成
- 脚本自动化访问

---

### 12. Web 资产管理

**优先级**：🟡 低
**预估工期**：2 周

#### 功能描述

- 管理常用 Web 后台链接
- 分组与标签管理
- 快速打开（新标签页/内嵌 iframe）
- 可选：自动登录（存储凭证）

---

### 13. 文件传输策略增强

**优先级**：🟡 中
**预估工期**：1 个月

#### 策略维度

| 维度 | 选项 |
|-----|------|
| 传输方向 | 仅上传 / 仅下载 / 双向 / 禁止 |
| 文件大小 | 单文件上限 / 总量上限 |
| 文件类型 | 白名单 / 黑名单（扩展名） |
| 适用范围 | 全局 / 用户组 / 用户 / 连接 / 分组 |

#### 数据表设计

```sql
CREATE TABLE transfer_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL,  -- global/user_group/user/connection/group
    scope_id TEXT,
    direction TEXT DEFAULT 'both',  -- upload/download/both/none
    max_file_size INTEGER,  -- bytes
    max_total_size INTEGER,  -- bytes per session
    allowed_extensions TEXT,  -- JSON array
    blocked_extensions TEXT,  -- JSON array
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### 14. 增强仪表盘

**优先级**：🟡 中
**预估工期**：1 个月

#### 展示内容

- **会话统计**：活跃会话数、今日连接数、会话时长分布
- **安全统计**：登录失败次数、命令拦截次数、异常告警
- **资产健康**：可配置 ping/端口检测，展示资产可用性
- **活动时间线**：最近的连接、操作、告警事件
- **存储统计**：录像文件占用空间、数据库大小
- **系统资源**：CPU、内存、磁盘使用率（后端服务器）

#### 可视化组件

- 使用 Chart.js / ECharts
- 支持时间范围筛选
- 数据自动刷新

---

## 实施路线图

```
2025 Q1 (1-3月)
├── 1月: 会话录像系统 - 后端录制服务
├── 2月: 会话录像系统 - 前端回放器 + 实时监控
└── 3月: 命令拦截器

2025 Q2 (4-6月)
├── 4月: 凭证管理中心
├── 5月: 资产分组管理
└── 6月: 批量命令执行

2025 Q3 (7-9月)
├── 7月: 计划任务系统
├── 8月: LDAP/SSO 集成
└── 9月: Kubernetes 支持

2025 Q4 (10-12月)
├── 10月: 文件传输策略 + Telnet
├── 11月: 增强仪表盘
└── 12月: SSH Server 模式 + Web 资产
```

---

## 技术建议

### 会话录像存储结构

```typescript
interface SessionRecording {
  id: string;
  sessionId: string;
  protocol: 'ssh' | 'rdp' | 'vnc';
  format: 'asciinema' | 'mp4' | 'guac';
  storage: 'local' | 's3' | 'minio';
  path: string;
  size: number;
  duration: number;
  compression: 'none' | 'gzip' | 'zstd';
  metadata: {
    user: string;
    connection: string;
    clientIp: string;
    terminalSize?: { cols: number; rows: number };
  };
  createdAt: Date;
}
```

### WebSocket 消息扩展

```typescript
// 新增消息类型
type WSMessageType =
  // 现有类型
  | 'terminal:data'
  | 'terminal:resize'
  // 监控相关
  | 'monitor:subscribe'      // 管理员订阅会话
  | 'monitor:unsubscribe'    // 取消订阅
  | 'monitor:broadcast'      // 向监控者广播数据
  | 'monitor:sessions'       // 活跃会话列表
  // 会话控制
  | 'session:terminate'      // 强制断开会话
  | 'session:takeover'       // 接管会话
  // 命令拦截
  | 'command:intercept'      // 命令拦截通知
  | 'command:approve'        // 审批通过
  | 'command:reject';        // 审批拒绝
```

### 推荐技术选型

| 功能 | 推荐方案 | 备选方案 |
|-----|---------|---------|
| SSH 录像格式 | asciinema v2 | ttyrec |
| RDP/VNC 录像 | Guacamole 原生 | FFmpeg 转码 |
| 对象存储 | MinIO | AWS S3 |
| 任务调度 | node-cron | Bull Queue |
| K8s 客户端 | @kubernetes/client-node | - |
| LDAP 客户端 | ldapjs | - |
| OAuth/OIDC | passport.js | openid-client |

---

## 参考资料

- [Next Terminal GitHub](https://github.com/dushixiang/next-terminal)
- [Next Terminal 官方文档](https://docs.next-terminal.typesafe.cn)
- [Next Terminal 功能详解 - CSDN](https://blog.csdn.net/zhengyukong/article/details/140110940)
- [asciinema 录像格式规范](https://github.com/asciinema/asciinema/blob/develop/doc/asciicast-v2.md)
- [Guacamole 会话录制](https://guacamole.apache.org/doc/gug/recording-playback.html)

---

**文档维护**：请在实施各功能时更新本文档的状态与实际完成时间
