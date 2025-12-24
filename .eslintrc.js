module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./packages/*/tsconfig.eslint.json'],
  },
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  plugins: ['@typescript-eslint', 'prettier'],
  rules: {
    // ============================================
    // TypeScript 相关规则
    // ============================================
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-use-before-define': [
      'error',
      {
        functions: false, // 允许函数提升
        classes: false, // 允许类在定义前被引用
        variables: false, // 允许变量在定义前被引用（常见于函数表达式）
        allowNamedExports: true,
        typedefs: false, // 允许类型在定义前被使用
      },
    ],
    '@typescript-eslint/naming-convention': 'off', // 项目已有命名约定
    '@typescript-eslint/no-shadow': 'warn', // 降级为警告
    '@typescript-eslint/ban-ts-comment': 'warn', // 降级为警告
    '@typescript-eslint/ban-types': 'warn', // 降级为警告
    '@typescript-eslint/no-loop-func': 'warn', // 降级为警告
    '@typescript-eslint/return-await': 'off', // 项目中有合理使用场景
    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/no-var-requires': 'off', // 某些场景需要动态 require
    // 禁用不存在的规则
    '@typescript-eslint/lines-between-class-members': 'off',
    '@typescript-eslint/no-throw-literal': 'off',

    // ============================================
    // 代码风格规则
    // ============================================
    'no-console': 'off', // 后端需要 console.log
    'no-plusplus': 'off', // ++/-- 是常见用法
    'no-continue': 'off', // continue 是有效的控制流语句
    'no-await-in-loop': 'off', // 有时需要顺序执行异步操作
    'no-nested-ternary': 'warn', // 降级为警告
    'no-param-reassign': [
      'error',
      {
        props: true,
        ignorePropertyModificationsFor: [
          'req', // Express request
          'res', // Express response
          'state', // Pinia/Vuex state
          'acc', // Array.reduce accumulator
          'e', // Event object
          'event', // Event object
          'ctx', // Koa context
          'draft', // Immer draft
          'el', // DOM element
          'element', // DOM element
          'node', // DOM node
          'socket', // WebSocket
          'ws', // WebSocket
          'client', // WebSocket client
          'request', // HTTP request
          'response', // HTTP response
          'container', // Docker container
          'terminal', // Xterm terminal
          'obj', // Generic object
          'activeClients', // Active clients map
        ],
        ignorePropertyModificationsForRegex: [
          '^dto',
          '^settings',
          '^config',
          'Ref$', // Vue refs (elementRef, etc.)
          '^old', // oldEl, oldValue, etc.
          '^new', // newEl, newValue, etc.
          '^current', // currentEl, currentValue, etc.
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ForInStatement',
        message:
          'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
      },
      // 允许 for...of 循环（现代 JS 常用语法）
      // 允许 generators（用于迭代器模式）
    ],
    'no-empty': 'off', // 关闭空代码块检查（空 catch 和空函数体在项目中有合理使用）
    'default-case': 'off', // 关闭 default-case 检查（有时不需要 default）
    'no-case-declarations': 'off', // 在 case 中声明变量是常见模式
    'no-promise-executor-return': 'off', // 有时需要在 Promise 执行器中返回
    'no-lonely-if': 'off', // 有时单独的 if 更清晰
    'no-useless-return': 'off', // 有时显式 return 更清晰
    'no-control-regex': 'off', // 有时需要匹配控制字符
    'no-bitwise': 'off', // 位运算是有效的操作
    'no-new': 'off', // 有时需要创建实例而不使用
    'no-else-return': 'off', // else return 有时更清晰
    'no-prototype-builtins': 'off', // 项目中安全使用
    'no-useless-escape': 'off', // 有时转义是为了可读性
    'no-void': 'off', // void 操作符有合理使用场景
    'no-async-promise-executor': 'warn', // 降级为警告
    'no-underscore-dangle': 'off',
    'class-methods-use-this': 'off',
    'consistent-return': 'off',
    'prefer-destructuring': 'off', // 有时直接访问更清晰
    'guard-for-in': 'off', // 配合 no-restricted-syntax 使用
    'no-return-assign': 'off', // 有时赋值返回是简洁写法
    'max-classes-per-file': 'off', // 允许多个类在一个文件

    // ============================================
    // Import 相关规则
    // ============================================
    'import/prefer-default-export': 'off',
    'import/no-cycle': 'warn', // 降级为警告（循环依赖应逐步重构）
    'import/no-duplicates': 'warn', // 降级为警告
    'import/order': 'off', // 导入顺序不强制
    'import/no-mutable-exports': 'off',
    'import/no-named-default': 'off',
  },
  overrides: [
    {
      // 测试文件特殊配置
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'import/no-extraneous-dependencies': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    '.eslintrc.js',
    '.prettierrc.js',
    'coverage',
    '.vite',
    '*.vue', // 暂时忽略 Vue 文件
    '*.config.ts', // 配置文件
    '**/tests/setup.ts',
  ],
};
