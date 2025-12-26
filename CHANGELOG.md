# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2025-12-27 (自然语言生成命令模块优化)

- **nl2cmd 优化**：DRY 重构，提取共享常量模块
- **nl2cmd 优化**：实现 Axios 客户端单例复用，避免重复创建
- **nl2cmd 优化**：新增流式响应支持（设置页开关，仅 OpenAI 支持）
- **nl2cmd 优化**：错误处理改为 fail-fast，移除重试逻辑，返回友好错误提示
- **测试增强**：nl2cmd.service.test.ts 16 个测试用例全部通过
- **新增 `packages/backend/src/ai-ops/nl2cmd.constants.ts`**：集中管理配置常量
- **前端类型更新**：新增 `streamingEnabled` 字段支持流式开关
- **新增 API**：`clearAxiosClientCache()` 用于缓存管理
- **Bug 修复**：API 429 错误日志输出格式，透传上游详细错误信息
- **Bug 修复**：测试用例中的 vitest mock 兼容性问题
- **Bug 修复**：Claude API headers，添加必需的 `x-api-key` 和 `anthropic-version` headers
- **Bug 修复**：流式响应，添加 `responseType: 'stream'` 配置，正确处理 NodeJS Stream

---

## 2025-12-24 (E2E 与集成测试框架实现)

- **Playwright E2E 测试框架**：
  - 新增目录：`packages/frontend/e2e/`
  - 配置文件：`playwright.config.ts`（支持 Chromium/Firefox/WebKit）
  - Page Object Model 设计：
    - `pages/login.page.ts`：登录页交互封装
    - `pages/workspace.page.ts`：工作区交互封装
    - `pages/settings.page.ts`：设置页交互封装
  - 测试 Fixtures：`fixtures/auth.fixture.ts`（认证状态管理）
  - 测试数据：`fixtures/test-data.ts`（SSH/RDP/VNC 连接配置）
  - E2E 测试用例：
    - `tests/auth.spec.ts`：认证流程（密码登录、2FA、Passkey）
    - `tests/ssh-connection.spec.ts`：SSH 连接与终端交互
    - `tests/sftp-operations.spec.ts`：SFTP 文件操作
    - `tests/remote-desktop.spec.ts`：RDP/VNC 远程桌面
- **SSH/SFTP 协议集成测试**：
  - 新增目录：`packages/backend/tests/integration/ssh/`、`packages/backend/tests/integration/sftp/`
  - Mock 服务器：`mock-ssh-server.ts`（MockSshServer、MockShellStream、MockSftpSession）
  - 测试用例：SSH 连接建立、Shell 操作、重连机制、SFTP 文件/目录操作
- **RDP/VNC 代理功能测试**：
  - 新增目录：`packages/backend/tests/integration/guacamole/`
  - 测试用例：
    - `guacamole.service.test.ts`：Token 生成与加密（AES-256-CBC）
    - `rdp-proxy.test.ts`：WebSocket 消息转发、Guacamole 协议解析
  - Remote Gateway 测试：`packages/remote-gateway/tests/server.test.ts`
- **测试脚本更新**：
  - 新增命令：`npm run test:e2e`、`npm run test:e2e:ui`、`npm run test:e2e:headed`
  - 新增依赖：`@playwright/test ^1.49.1`
- **测试结果**：Backend 59 个测试文件，1,223 个测试用例全部通过

## 2025-12-24 (安全增强与技术债务清零)

- **安全增强**：
  - bcrypt saltRounds 从 10 提升至 12（符合 2025 年安全标准）
  - 实现加密密钥轮换机制（`crypto.ts` 重构）
    - 支持多版本密钥共存
    - 新增 `rotateEncryptionKey()` / `reEncrypt()` / `getKeyRotationStatus()` API
    - 新加密格式：`[keyVersion(4B)][iv(16B)][encrypted][tag(16B)]`
    - 保持向后兼容：自动识别并解密旧格式数据
  - 代码审查报告 13 项问题全部修复（P0-P3）
- **技术债务清零**：24/24 项技术债务已全部修复（100%）
- **测试覆盖率大幅提升**：
  - 新增 20+ 测试文件（Backend + Frontend）
  - ESLint 配置优化，164 文件变更
- **文档状态**：所有核心模块文档已更新至最新状态

## 2025-12-24 00:09:22 (AI 上下文完整性验证)

- **覆盖率验证**：完成全仓扫描，确认模块文档完整性与数据准确性
- **文件统计更新**：
  - Backend: 177 个 TypeScript 文件
  - Frontend: 184 个 TypeScript/Vue 文件
  - Remote Gateway: 1 个 TypeScript 文件
  - **总计：362 个源代码文件**
- **测试框架确认**：Backend 与 Frontend 均已配置 Vitest 测试框架
- **索引更新**：更新 `.claude/index.json`，添加详细模块特性、测试配置、近期更新记录
- **文档状态**：所有核心模块文档（CLAUDE.md）已完整且最新，覆盖率 100%

## 2025-12-23 (技术债务整理)

- **技术债务报告**：新增 `doc/TECHNICAL_DEBT_REPORT.md`，完整分析代码库中的 TODO/FIXME 标记
- **发现数量**：24 个技术债务标记（Backend: 11 个，Frontend: 13 个）
- **优先级分类**：高优先级 7 个，中优先级 12 个，低优先级 5 个
- **问题分类**：错误处理缺失（10个）、安全/验证不完善（3个）、类型定义不精确（3个）等
- **处理建议**：按优先级分三批处理，预估总工作量 15-20 人天

## 2025-12-22 (Phase 6-11 规划)

- **个人版路线图草案**：新增 `doc/PERSONAL_ROADMAP.md`，聚焦单用户工作流
- **规划范围**：Phase 6-11 及长期愿景（AI Copilot、插件体系等）
- **实施策略**：分阶段列出 DB 结构、后端/前端目录规划、估算工期
- **定位重申**：强调无需多用户/权限体系，聚焦个人运维效率

## 2025-12-21 (Phase 3-5 功能实现)

- **Phase 3: WebSocket 基础设施升级** (Codex Review: 94/100 APPROVE)
  - 心跳机制：桌面/移动端差异化心跳检测 (`websocket/heartbeat.ts`)
  - 连接管理：客户端类型检测与验证 (`websocket/connection.ts`)
  - 状态广播：用户 Socket 映射与死连接清理 (`websocket/state.ts`)
  - 数据库索引：审计日志查询优化 (`schema.registry.ts`)

- **Phase 4: 批量作业模块** (Codex Review: 92/100 APPROVE)
  - 新增模块：`packages/backend/src/batch/`
  - 多服务器命令广播：支持并发执行、取消、进度追踪
  - 数据表：`batch_tasks`、`batch_subtasks`
  - WebSocket 实时进度推送

- **Phase 5: AI 智能运维模块** (Codex Review: 90/100 后端, 93/100 前端 APPROVE)
  - 后端模块：`packages/backend/src/ai-ops/`
    - AI 会话管理（UUID 标识）
    - 系统健康分析、命令模式分析、安全事件分析
    - 连接统计分析、自然语言查询路由
  - 前端模块：`packages/frontend/src/features/ai-ops/`
    - AIAssistantPanel 聊天组件（XSS 防护、自动滚动）
  - 前端模块：`packages/frontend/src/features/batch-ops/`
    - MultiServerExec 多服务器执行组件
  - 数据表：`ai_sessions`、`ai_messages`

## 2025-12-20 22:27:42 (增量更新)

- **模块文档完善**：为 3 个核心模块生成独立 CLAUDE.md 文档
- **导航面包屑**：为各模块文档添加返回根文档的导航链接
- **Mermaid 结构图**：更新模块结构图，添加模块间通信流程图
- **覆盖率更新**：已扫描 283 个源代码文件，模块覆盖率 100%

## 2025-12-20 22:27:42 (初始创建)

- **初始化架构文档**：完成项目架构分析与模块索引建立
- **模块识别**：识别 3 个核心模块（backend、frontend、remote-gateway）
- **技术栈确认**：TypeScript + Vue 3 + Express.js + SQLite3 + Docker
