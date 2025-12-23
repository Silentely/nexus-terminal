/**
 * Commitlint 配置
 * 基于 Conventional Commits 规范
 * @see https://www.conventionalcommits.org/
 * @see https://commitlint.js.org/
 */

module.exports = {
  extends: ['@commitlint/config-conventional'],

  /**
   * 自定义规则
   */
  rules: {
    /**
     * Type 类型枚举
     * 默认类型：
     * - feat: 新功能
     * - fix: 修复 Bug
     * - docs: 文档变更
     * - style: 代码格式（不影响功能）
     * - refactor: 重构（既不是新功能也不是 Bug 修复）
     * - perf: 性能优化
     * - test: 测试相关
     * - build: 构建系统或外部依赖变更
     * - ci: CI 配置文件和脚本变更
     * - chore: 其他不修改 src 或测试文件的变更
     * - revert: 回退之前的提交
     */
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // Bug 修复
        'docs', // 文档变更
        'style', // 代码格式
        'refactor', // 重构
        'perf', // 性能优化
        'test', // 测试
        'build', // 构建系统
        'ci', // CI 配置
        'chore', // 其他变更
        'revert', // 回退
        'security', // 安全修复（自定义）
        'release', // 发布版本（自定义）
      ],
    ],

    // Subject 最大长度
    'subject-max-length': [2, 'always', 100],

    // Subject 不能为空
    'subject-empty': [2, 'never'],

    // Type 必须小写
    'type-case': [2, 'always', 'lower-case'],

    // Subject 不能以句号结尾
    'subject-full-stop': [2, 'never', '.'],

    // Header 最大长度
    'header-max-length': [2, 'always', 120],

    // Body 前必须有空行
    'body-leading-blank': [2, 'always'],

    // Footer 前必须有空行
    'footer-leading-blank': [2, 'always'],

    // Scope 不强制要求
    'scope-empty': [0],

    // 允许多个 Body
    'body-max-line-length': [0],
  },

  /**
   * 提示消息配置
   */
  prompt: {
    messages: {
      type: '选择你要提交的类型:',
      scope: '选择一个 scope（可选）:',
      subject: '填写简短的变更描述:',
      body: '填写更详细的变更描述（可选）:',
      footer: '列出关闭的 issues（可选）:',
    },
  },

  /**
   * 忽略规则
   * 例如：忽略合并提交、回退提交等
   */
  ignores: [
    (commit) => commit.includes('WIP'), // 忽略 WIP 提交
    (commit) => commit.includes('Merge branch'), // 忽略 merge 提交
  ],
};
