# 贡献指南

感谢您对星枢终端（Nexus Terminal）项目的关注！

## 快速开始

详细的贡献指南请参阅 [docs/contributing.md](./docs/contributing.md)。

## 开发环境

- Node.js 18+
- npm 8+
- Git 2.30+

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

## 更多信息

请阅读完整的 [贡献指南](./docs/contributing.md) 了解详细信息。
