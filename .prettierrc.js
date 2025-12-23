module.exports = {
  // 审查报告推荐配置
  singleQuote: true,

  // 基础配置
  semi: true,
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  trailingComma: 'es5',
  arrowParens: 'always',
  endOfLine: 'lf',

  // Vue 文件配置
  overrides: [
    {
      files: '*.vue',
      options: {
        parser: 'vue',
      },
    },
  ],
};
