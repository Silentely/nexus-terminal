# 贡献指南

感谢您对星枢终端（Nexus Terminal）项目的关注！

## 开发环境

- Node.js 22+
- npm 10+
- Git 2.30+
- Guacd daemon（RDP/VNC 测试需要，端口 4822）

## 项目结构

本项目采用 monorepo 架构，包含三个子包：

- `packages/backend` — Express + SQLite 后端服务（端口 3001）
- `packages/frontend` — Vue 3 + Vite 前端应用（端口 5173）
- `packages/remote-gateway` — Guacamole Lite 远程桌面网关（端口 8081/9090）

### 本地开发启动

```bash
npm install                                    # 安装所有子包依赖
cd packages/backend && npm run dev             # 后端 :3001
cd packages/frontend && npm run dev            # 前端 :5173
cd packages/remote-gateway && npm run dev      # 网关 :8081/9090（需要 Guacd）
```

> **注意**：远程桌面网关（RDP/VNC）需要先启动 Guacd daemon，SSH/SFTP/Telnet 功能不依赖 Guacd。

## 提交规范

本项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### 类型说明

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 重构（既不是新功能也不是修复）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

## 分支命名

- `feature/*` - 新功能开发
- `fix/*` - Bug 修复
- `docs/*` - 文档更新
- `refactor/*` - 重构

## 代码风格

- TypeScript 严格模式
- ESLint + Prettier 自动格式化
- 提交前自动运行 lint-staged

## 测试要求

- 单元测试覆盖率目标：Service >=80%, Utils >=90%
- 所有测试必须通过才能合并
- 使用中文描述测试用例

```bash
npm test                        # 运行所有单元测试
npm run test:backend            # 仅后端测试
npm run test:frontend           # 仅前端测试
npm run test:coverage           # 覆盖率报告（低于阈值会失败）
```

## 更多信息

- [CLAUDE.md](./CLAUDE.md) — 完整的架构说明、编码规范和测试策略
- [docs/contributing.md](./docs/contributing.md) — 详细的贡献流程和最佳实践
