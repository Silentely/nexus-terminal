module.exports = {
  // TypeScript 和 JavaScript 文件
  '*.{js,ts}': ['eslint --fix', 'prettier --write'],

  // Vue 文件（暂时只格式化，不 lint）
  '*.vue': ['prettier --write'],

  // JSON、CSS、Markdown 等文件
  '*.{json,css,md}': ['prettier --write'],
};
