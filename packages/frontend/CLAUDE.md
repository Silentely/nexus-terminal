# Frontend Module - @nexus-terminal/frontend

> [← 返回根文档](../../CLAUDE.md) | **packages/frontend**

---

## 变更记录 (Changelog)

### 2025-12-21 (Phase 5 - AI 智能运维 & 批量操作前端)

- **新增 AI 模块**：
  - `types/ai.types.ts`：AI 会话/消息类型定义
  - `stores/ai.store.ts`：AI 状态管理（会话、消息、建议）
  - `features/ai-ops/AIAssistantPanel.vue`：AI 助手聊天面板（含 XSS 防护、自动滚动）
- **新增 Batch 模块**：
  - `types/batch.types.ts`：批量任务/子任务类型定义
  - `stores/batch.store.ts`：批量任务状态管理（WebSocket 事件处理、轮询）
  - `features/batch-ops/MultiServerExec.vue`：多服务器命令执行面板
- **Codex 审查通过**：93/100 APPROVE

### 2025-12-20 22:27:42

- **初始化模块文档**：完成前端模块架构分析与文档建立
- **组件索引**：识别 53 个 Vue 组件
- **状态管理**：识别 21 个 Pinia stores
- **路由配置**：识别 9 个视图路由
- **覆盖率**：模块文档初始化完成

---

## 模块概述

**@nexus-terminal/frontend** 是星枢终端的 Web 前端应用，基于 Vue 3 构建，提供：

- 多标签页终端界面（Xterm.js）
- 文件管理器（SFTP）
- Monaco 代码编辑器
- 远程桌面查看器（RDP/VNC via Guacamole）
- 高度可定制的主题与布局
- PWA 支持

---

## 技术栈

| 类别      | 技术/库                             |
| --------- | ----------------------------------- |
| 框架      | Vue 3.3+ (Composition API)          |
| 构建工具  | Vite 5.x                            |
| 语言      | TypeScript 5.x                      |
| 状态管理  | Pinia + pinia-plugin-persistedstate |
| 路由      | Vue Router 4.x                      |
| UI 组件库 | Element Plus                        |
| 终端模拟  | Xterm.js + xterm-addon-\*           |
| 代码编辑  | Monaco Editor + CodeMirror          |
| 图表      | Chart.js + vue-chartjs              |
| 远程桌面  | guacamole-common-js                 |
| 工具库    | @vueuse/core, date-fns, axios       |
| 国际化    | vue-i18n                            |
| 样式      | Tailwind CSS 4.x                    |

---

## 目录结构

```
packages/frontend/
├── src/
│   ├── main.ts                     # 应用入口
│   ├── App.vue                     # 根组件
│   ├── style.css                   # 全局样式
│   ├── i18n.ts                     # 国际化配置
│   │
│   ├── router/
│   │   └── index.ts                # 路由配置与守卫
│   │
│   ├── stores/                     # Pinia 状态管理
│   │   ├── auth.store.ts           # 认证状态
│   │   ├── connections.store.ts    # 连接管理
│   │   ├── session.store.ts        # SSH 会话状态
│   │   ├── settings.store.ts       # 系统设置
│   │   ├── appearance.store.ts     # 外观设置
│   │   ├── layout.store.ts         # 布局配置
│   │   ├── fileEditor.store.ts     # 文件编辑器状态
│   │   ├── quickCommands.store.ts  # 快捷指令
│   │   ├── notifications.store.ts  # 通知配置
│   │   ├── audit.store.ts          # 审计日志
│   │   └── ...                     # 其他 stores
│   │
│   ├── views/                      # 页面视图
│   │   ├── DashboardView.vue       # 仪表盘
│   │   ├── LoginView.vue           # 登录页
│   │   ├── SetupView.vue           # 初始设置
│   │   ├── WorkspaceView.vue       # 工作区（核心）
│   │   ├── ConnectionsView.vue     # 连接管理
│   │   ├── ProxiesView.vue         # 代理管理
│   │   ├── SettingsView.vue        # 系统设置
│   │   ├── NotificationsView.vue   # 通知设置
│   │   └── AuditLogView.vue        # 审计日志
│   │
│   ├── components/                 # Vue 组件
│   │   ├── Terminal.vue            # 终端组件
│   │   ├── FileManager.vue         # 文件管理器
│   │   ├── MonacoEditor.vue        # Monaco 编辑器
│   │   ├── ConnectionList.vue      # 连接列表
│   │   ├── CommandInputBar.vue     # 命令输入栏
│   │   ├── StyleCustomizer.vue     # 样式定制器
│   │   ├── LayoutRenderer.vue      # 布局渲染器
│   │   ├── LayoutConfigurator.vue  # 布局配置器
│   │   ├── DockerManager.vue       # Docker 管理面板
│   │   ├── RemoteDesktopModal.vue  # RDP 远程桌面
│   │   ├── VncModal.vue            # VNC 连接
│   │   ├── common/                 # 通用组件
│   │   ├── settings/               # 设置相关组件
│   │   └── style-customizer/       # 样式定制相关
│   │
│   ├── composables/                # 组合式函数
│   │   └── ...                     # 可复用逻辑
│   │
│   ├── features/                   # 功能模块
│   │   ├── appearance/             # 外观功能
│   │   │   └── config/             # 预设主题配置
│   │   ├── ai-ops/                 # AI 智能运维 (Phase 5)
│   │   │   └── AIAssistantPanel.vue
│   │   └── batch-ops/              # 批量操作 (Phase 4)
│   │       └── MultiServerExec.vue
│   │
│   ├── types/                      # TypeScript 类型定义
│   │   ├── connection.ts
│   │   ├── settings.ts
│   │   ├── appearance.ts
│   │   ├── ai.types.ts             # AI 会话/消息类型 (Phase 5)
│   │   ├── batch.types.ts          # 批量任务类型 (Phase 4)
│   │   └── ...
│   │
│   ├── utils/                      # 工具函数
│   │   └── ...
│   │
│   ├── assets/                     # 静态资源
│   │   └── ...
│   │
│   └── locales/                    # 多语言资源
│       ├── zh-CN/
│       └── en-US/
│
├── public/                         # 公共资源
│   └── sw.js                       # Service Worker (PWA)
│
├── index.html                      # HTML 入口
├── vite.config.ts                  # Vite 配置
├── tsconfig.json                   # TypeScript 配置
├── nginx.conf                      # Nginx 配置（Docker 部署）
├── Dockerfile                      # Docker 构建配置
└── package.json                    # 包配置
```

---

## 路由配置

| 路径             | 名称          | 视图组件              | 描述                       |
| ---------------- | ------------- | --------------------- | -------------------------- |
| `/`              | Dashboard     | DashboardView.vue     | 仪表盘/首页                |
| `/login`         | Login         | LoginView.vue         | 用户登录                   |
| `/setup`         | Setup         | SetupView.vue         | 初始设置（首次使用）       |
| `/workspace`     | Workspace     | WorkspaceView.vue     | 工作区（终端+文件+编辑器） |
| `/connections`   | Connections   | ConnectionsView.vue   | 连接配置管理               |
| `/proxies`       | Proxies       | ProxiesView.vue       | 代理配置管理               |
| `/settings`      | Settings      | SettingsView.vue      | 系统设置                   |
| `/notifications` | Notifications | NotificationsView.vue | 通知渠道配置               |
| `/audit-logs`    | AuditLogs     | AuditLogView.vue      | 审计日志查看               |

### 路由守卫

- **认证检查**：非公开路由需要登录
- **初始设置检查**：首次使用强制进入 `/setup`
- **登录重定向**：已登录用户访问 `/login` 重定向到 `/`

---

## 状态管理 (Pinia Stores)

### 核心 Stores

| Store                 | 文件                 | 职责                                 |
| --------------------- | -------------------- | ------------------------------------ |
| `useAuthStore`        | auth.store.ts        | 用户认证状态、登录/登出、2FA/Passkey |
| `useConnectionsStore` | connections.store.ts | 连接列表、CRUD 操作                  |
| `useSessionStore`     | session.store.ts     | 活跃 SSH 会话管理                    |
| `useSettingsStore`    | settings.store.ts    | 系统设置读写                         |
| `useAppearanceStore`  | appearance.store.ts  | 外观/主题设置                        |
| `useLayoutStore`      | layout.store.ts      | 工作区布局配置                       |

### 功能 Stores

| Store                      | 文件                      | 职责                         |
| -------------------------- | ------------------------- | ---------------------------- |
| `useFileEditorStore`       | fileEditor.store.ts       | 文件编辑器标签页与内容       |
| `useQuickCommandsStore`    | quickCommands.store.ts    | 快捷指令管理                 |
| `useQuickCommandTagsStore` | quickCommandTags.store.ts | 快捷指令标签                 |
| `useCommandHistoryStore`   | commandHistory.store.ts   | 命令历史                     |
| `usePathHistoryStore`      | pathHistory.store.ts      | 路径浏览历史                 |
| `useFavoritePathsStore`    | favoritePaths.store.ts    | 收藏路径                     |
| `useNotificationsStore`    | notifications.store.ts    | 通知配置                     |
| `useAuditStore`            | audit.store.ts            | 审计日志                     |
| `useProxiesStore`          | proxies.store.ts          | 代理配置                     |
| `useTagsStore`             | tags.store.ts             | 连接标签                     |
| `useSshKeysStore`          | sshKeys.store.ts          | SSH 密钥管理                 |
| `useDialogStore`           | dialog.store.ts           | 全局对话框状态               |
| `useUINotificationsStore`  | uiNotifications.store.ts  | UI 通知/Toast                |
| `useFocusSwitcherStore`    | focusSwitcher.store.ts    | 焦点切换配置                 |
| `useAIStore`               | ai.store.ts               | AI 会话与消息管理（Phase 5） |
| `useBatchStore`            | batch.store.ts            | 批量任务状态管理（Phase 4）  |

---

## 核心组件

### 终端相关

| 组件                     | 描述                       |
| ------------------------ | -------------------------- |
| `Terminal.vue`           | 基于 Xterm.js 的终端模拟器 |
| `TerminalTabBar.vue`     | 终端标签栏                 |
| `VirtualKeyboard.vue`    | 移动端虚拟键盘             |
| `CommandInputBar.vue`    | 命令输入栏（支持同步输入） |
| `CommandHistoryMenu.vue` | 命令历史菜单               |

### 文件管理

| 组件                         | 描述            |
| ---------------------------- | --------------- |
| `FileManager.vue`            | SFTP 文件管理器 |
| `FileManagerContextMenu.vue` | 右键上下文菜单  |
| `FileManagerActionModal.vue` | 文件操作对话框  |
| `FileUploadPopup.vue`        | 上传进度弹窗    |
| `TransferProgressModal.vue`  | 传输进度模态框  |

### 编辑器

| 组件                         | 描述                     |
| ---------------------------- | ------------------------ |
| `MonacoEditor.vue`           | Monaco 代码编辑器封装    |
| `FileEditorContainer.vue`    | 编辑器容器               |
| `FileEditorTabs.vue`         | 编辑器标签栏             |
| `FileEditorOverlay.vue`      | 编辑器覆盖层             |
| `CodeMirrorMobileEditor.vue` | 移动端 CodeMirror 编辑器 |

### 布局与样式

| 组件                     | 描述           |
| ------------------------ | -------------- |
| `LayoutRenderer.vue`     | 动态布局渲染   |
| `LayoutConfigurator.vue` | 布局配置界面   |
| `LayoutNodeEditor.vue`   | 布局节点编辑器 |
| `StyleCustomizer.vue`    | 主题样式定制   |
| `PaneTitleBar.vue`       | 面板标题栏     |

### 连接管理

| 组件                          | 描述               |
| ----------------------------- | ------------------ |
| `ConnectionList.vue`          | 连接列表展示       |
| `WorkspaceConnectionList.vue` | 工作区侧边连接列表 |
| `AddConnectionForm.vue`       | 新增连接表单       |
| `BatchEditConnectionForm.vue` | 批量编辑连接       |
| `SshKeyManagementModal.vue`   | SSH 密钥管理模态框 |

### 远程桌面

| 组件                     | 描述               |
| ------------------------ | ------------------ |
| `RemoteDesktopModal.vue` | RDP 远程桌面模态框 |
| `VncModal.vue`           | VNC 连接模态框     |

### 其他功能

| 组件                            | 描述                |
| ------------------------------- | ------------------- |
| `DockerManager.vue`             | Docker 容器管理面板 |
| `StatusMonitor.vue`             | 状态监控            |
| `StatusCharts.vue`              | 状态图表            |
| `QuickCommandsModal.vue`        | 快捷指令管理        |
| `SuspendedSshSessionsModal.vue` | 挂起会话管理        |
| `NotificationSettings.vue`      | 通知设置            |

### AI 与批量操作（Phase 4/5）

| 组件                   | 描述                                               |
| ---------------------- | -------------------------------------------------- |
| `AIAssistantPanel.vue` | AI 助手聊天面板（含 XSS 防护、自动滚动、历史会话） |
| `MultiServerExec.vue`  | 多服务器批量命令执行面板（含轮询、状态徽章）       |

---

## 关键文件清单

### 入口与配置

- `src/main.ts` - 应用入口，Pinia/Router/i18n 初始化
- `src/App.vue` - 根组件，全局布局
- `src/router/index.ts` - 路由配置与守卫
- `vite.config.ts` - Vite 构建配置

### 核心视图

- `src/views/WorkspaceView.vue` - 工作区（最核心的页面）
- `src/views/DashboardView.vue` - 仪表盘
- `src/views/LoginView.vue` - 登录页

### 状态管理

- `src/stores/auth.store.ts` - 认证状态
- `src/stores/session.store.ts` - 会话管理
- `src/stores/connections.store.ts` - 连接管理
- `src/stores/appearance.store.ts` - 外观主题
- `src/stores/ai.store.ts` - AI 会话与消息管理（Phase 5）
- `src/stores/batch.store.ts` - 批量任务状态管理（Phase 4）

### 样式

- `src/style.css` - 全局 CSS
- `src/features/appearance/config/` - 预设主题配置

---

## 运行命令

```bash
# 开发模式（热重载，默认端口 5173）
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

---

## 开发约定

### 组件命名

- 使用 PascalCase 命名组件文件（如 `Terminal.vue`）
- 功能模块相关组件放在对应目录下（如 `settings/`、`style-customizer/`）

### Composition API

- 所有组件使用 `<script setup lang="ts">`
- 使用 `defineProps`、`defineEmits` 定义接口
- 复用逻辑抽取到 `composables/`

### 状态管理

- Store 命名：`use{Name}Store`
- Store 文件：`{name}.store.ts`
- 使用 `pinia-plugin-persistedstate` 持久化关键状态

### 样式

- 优先使用 Tailwind CSS 类
- 组件特定样式使用 `<style scoped>`
- 全局样式放在 `src/style.css`

---

## 常见问题 (FAQ)

### Q: 如何添加新页面？

1. 在 `src/views/` 创建 `{Name}View.vue`
2. 在 `src/router/index.ts` 添加路由配置
3. 如需状态管理，在 `src/stores/` 创建对应 store

### Q: 如何添加新组件？

1. 根据功能归类放入 `src/components/` 或子目录
2. 使用 Composition API + TypeScript
3. 如需多处复用逻辑，抽取到 `src/composables/`

### Q: 终端主题如何配置？

- 预设主题定义在 `src/features/appearance/config/`
- 用户自定义主题通过 `useAppearanceStore` 管理
- 终端组件从 store 获取主题配置

### Q: 如何与后端 API 交互？

- 使用 axios 发起请求
- API 调用逻辑放在对应的 store actions 中
- 类型定义放在 `src/types/`

---

**文档生成时间**：2025-12-21（Phase 4/5 更新）
