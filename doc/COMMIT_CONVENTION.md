# Git 提交规范 (Commit Convention)

> 星枢终端项目采用 Conventional Commits 规范，使用 Commitlint 自动检查提交消息格式

---

## 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 示例

```bash
feat(connections): 添加 SSH 连接断线自动重连功能

实现了 SSH 连接意外断开时的自动重连机制：
- 最多重试 3 次
- 每次重试间隔递增（1s, 2s, 4s）
- 保持终端状态不变

Closes #123
```

---

## Type 类型

| Type       | 说明                           | 示例                                  |
| ---------- | ------------------------------ | ------------------------------------- |
| `feat`     | 新功能                         | `feat(batch): 添加批量命令执行功能`   |
| `fix`      | Bug 修复                       | `fix(sftp): 修复文件上传进度显示错误` |
| `docs`     | 文档变更                       | `docs: 更新 API 文档`                 |
| `style`    | 代码格式（不影响功能）         | `style: 统一缩进为 2 空格`            |
| `refactor` | 重构（既不是新功能也不是修复） | `refactor(auth): 简化登录逻辑`        |
| `perf`     | 性能优化                       | `perf(websocket): 优化心跳机制`       |
| `test`     | 测试相关                       | `test(connections): 添加单元测试`     |
| `build`    | 构建系统或外部依赖变更         | `build: 升级 TypeScript 到 5.x`       |
| `ci`       | CI 配置文件和脚本变更          | `ci: 添加自动化依赖审计`              |
| `chore`    | 其他变更                       | `chore: 更新 .gitignore`              |
| `revert`   | 回退之前的提交                 | `revert: 回退 feat(batch) 提交`       |
| `security` | 安全修复（自定义）             | `security: 修复 SQL 注入漏洞`         |
| `release`  | 发布版本（自定义）             | `release: v1.2.0`                     |

---

## Scope 范围（可选）

Scope 用于说明提交影响的范围，可以是模块名、文件名或功能名。

### 常用 Scope

- `connections` - 连接管理
- `sftp` - 文件传输
- `auth` - 用户认证
- `batch` - 批量操作
- `ai-ops` - AI 智能运维
- `websocket` - WebSocket 通信
- `database` - 数据库
- `frontend` - 前端
- `backend` - 后端
- `docker` - Docker 相关
- `settings` - 设置
- `notifications` - 通知
- `audit` - 审计日志
- `ui` - 用户界面

如果变更影响多个范围，可以省略 scope 或使用 `*` 表示全局。

---

## Subject 主题

- **简短描述**：不超过 100 个字符
- **使用祈使句**：如 "添加"、"修复"、"更新"，而不是 "添加了"、"已修复"
- **首字母小写**：除非是专有名词
- **不加句号**：主题结尾不要加句号
- **用中文描述**：本项目使用中文提交消息

### ✅ 好的示例

```
feat(auth): 添加 Passkey 登录支持
fix(sftp): 修复上传大文件时内存溢出问题
refactor(websocket): 重构心跳机制以提高性能
```

### ❌ 不好的示例

```
添加了新功能。             # 缺少 type
feat: update                # subject 太简短
feat(auth): 添加了。        # 使用了"了"，不是祈使句
FIX: some bug.              # type 应该小写，subject 应该用中文
feat(auth): 添加功能。      # 主题不应该以句号结尾
```

---

## Body 正文（可选）

- **详细描述**：解释为什么做这个变更，以及实现方式
- **换行分段**：body 与 subject 之间空一行
- **使用列表**：可以使用 `-` 或 `*` 列出要点
- **补充细节**：说明变更的动机、实现细节、影响范围等

### 示例

```
feat(batch): 添加批量命令执行功能

实现了在多个服务器上并发执行命令的功能：
- 支持自定义并发数（1-50）
- 支持超时控制（1-3600 秒）
- 支持任务取消与进度追踪
- 实时 WebSocket 推送子任务状态

数据库新增 batch_tasks 和 batch_subtasks 表。
```

---

## Footer 页脚（可选）

### 关闭 Issue

使用 `Closes`、`Fixes`、`Resolves` 关键字关联 Issue：

```
Closes #123
Fixes #456, #789
Resolves #100
```

### Breaking Changes

如果变更包含破坏性改动（不向后兼容），需要在 footer 中说明：

```
BREAKING CHANGE: 移除了旧版 API v1，请迁移到 v2
```

或者在 type 后面加 `!`：

```
feat(api)!: 重构 RESTful API 结构
```

---

## 完整示例

### 简单提交

```bash
git commit -m "fix(sftp): 修复文件下载中文文件名乱码"
```

### 包含 Body 的提交

```bash
git commit -m "feat(ai-ops): 添加系统健康分析功能

实现了基于 AI 的系统健康分析：
- 分析 CPU、内存、磁盘使用率
- 识别异常进程和资源泄漏
- 提供优化建议

Closes #234"
```

### 破坏性变更

```bash
git commit -m "refactor(database)!: 重构数据库 Schema

将 connections 表拆分为 ssh_connections 和 rdp_connections，
提高查询性能并简化数据结构。

BREAKING CHANGE: 旧版数据需要执行迁移脚本 migrate_v2.sql

Closes #345"
```

---

## 验证机制

项目使用 Husky + Commitlint 在提交时自动检查格式：

1. **Pre-commit Hook**：运行代码格式化和 Lint 检查
2. **Commit-msg Hook**：检查提交消息是否符合 Conventional Commits 规范

### 如果提交消息格式错误

```bash
$ git commit -m "update code"

⧗   input: update code
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]

✖   found 2 problems, 0 warnings
```

### 正确的提交方式

```bash
$ git commit -m "feat(connections): 添加连接分组功能"

[main 1a2b3c4] feat(connections): 添加连接分组功能
 3 files changed, 150 insertions(+), 20 deletions(-)
```

---

## 配置文件

- **Commitlint 配置**：`commitlint.config.js`
- **Husky Hooks**：`.husky/commit-msg`
- **规则扩展**：基于 `@commitlint/config-conventional`

---

## 常见问题 (FAQ)

### Q: 可以使用 Emoji 吗？

不推荐。本项目采用严格的 Conventional Commits 规范，不使用 Emoji。

### Q: 提交消息必须用中文吗？

是的。为了保持项目一致性，所有提交消息的 subject 和 body 应使用简体中文。

### Q: 如何跳过提交检查？

**不推荐**跳过检查。如果确实需要（如紧急修复），可以使用：

```bash
git commit --no-verify -m "emergency fix"
```

但这会跳过所有 Git hooks（包括代码检查），请谨慎使用。

### Q: WIP 提交怎么办？

WIP（Work In Progress）提交会被自动忽略，但建议使用正确的格式：

```bash
git commit -m "wip: 正在开发批量操作功能"
```

### Q: Merge 提交会被检查吗？

不会。Commitlint 会自动忽略以 `Merge branch` 开头的提交。

---

## 参考资源

- [Conventional Commits 规范](https://www.conventionalcommits.org/)
- [Commitlint 文档](https://commitlint.js.org/)
- [Angular 提交规范](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#commit)

---

**文档生成时间**：2025-12-23
**相关任务**：工具链 - 实施 Commitlint
