/**
 * OpenAPI/Swagger 配置文件
 * 定义 API 文档的基本信息和规范
 */

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '星枢终端 API',
      version: '1.5.5',
      description: `
# 星枢终端 - RESTful API 文档

现代化、功能丰富的 Web SSH / RDP / VNC 客户端后端 API。

## 功能特性

- 🔐 用户认证（密码、2FA、Passkey）
- 🖥️ SSH/SFTP/RDP/VNC 连接管理
- 📁 文件管理与传输
- 🔄 会话挂起与恢复
- 🎨 终端主题与外观定制
- 📊 审计日志与通知系统
- 🐳 Docker 容器管理
- ⚡ 批量命令执行
- 🤖 AI 智能运维分析

## 认证说明

本 API 使用 **Session Cookie** 进行身份验证。

1. 首先调用 \`POST /api/v1/auth/login\` 登录
2. 服务器返回 Set-Cookie 头设置会话 Cookie
3. 后续请求自动携带 Cookie 进行认证
4. Cookie 有效期：30 天（默认配置）

## 错误处理

所有错误响应遵循统一格式：

\`\`\`json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "用户友好的错误消息",
    "requestId": "请求追踪 ID",
    "timestamp": "2025-12-23T10:30:00.000Z"
  }
}
\`\`\`

常见错误代码：
- \`BAD_REQUEST\` (400) - 请求参数错误
- \`UNAUTHORIZED\` (401) - 未登录或认证失败
- \`FORBIDDEN\` (403) - 无权访问
- \`NOT_FOUND\` (404) - 资源不存在
- \`VALIDATION_ERROR\` (422) - 数据验证失败
- \`INTERNAL_SERVER_ERROR\` (500) - 服务器内部错误
      `,
      contact: {
        name: 'Nexus Terminal',
        url: 'https://github.com/Silentely/nexus-terminal',
      },
      license: {
        name: 'GPL-3.0',
        url: 'https://www.gnu.org/licenses/gpl-3.0.html',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: '开发服务器',
      },
      {
        url: 'http://localhost:18111',
        description: '生产服务器（Docker）',
      },
    ],
    tags: [
      { name: 'auth', description: '用户认证与授权' },
      { name: 'connections', description: 'SSH/RDP/VNC 连接管理' },
      { name: 'sftp', description: 'SFTP 文件操作' },
      { name: 'batch', description: '批量命令执行' },
      { name: 'ai-ops', description: 'AI 智能运维分析' },
      { name: 'tags', description: '连接标签管理' },
      { name: 'proxies', description: '代理配置管理' },
      { name: 'settings', description: '系统设置' },
      { name: 'notifications', description: '通知渠道配置' },
      { name: 'audit', description: '审计日志查询' },
      { name: 'command-history', description: '命令历史记录' },
      { name: 'quick-commands', description: '快捷指令管理' },
      { name: 'terminal-themes', description: '终端主题配置' },
      { name: 'appearance', description: '外观设置' },
      { name: 'ssh-keys', description: 'SSH 密钥管理' },
      { name: 'transfers', description: '文件传输状态' },
      { name: 'path-history', description: '路径浏览历史' },
      { name: 'favorite-paths', description: '收藏路径管理' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid',
          description: 'Session Cookie（通过 /api/v1/auth/login 获取）',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  enum: [
                    'BAD_REQUEST',
                    'UNAUTHORIZED',
                    'FORBIDDEN',
                    'NOT_FOUND',
                    'VALIDATION_ERROR',
                    'INTERNAL_SERVER_ERROR',
                    'DATABASE_ERROR',
                    'SERVICE_UNAVAILABLE',
                    'INVALID_CREDENTIALS',
                    'CAPTCHA_REQUIRED',
                    'CAPTCHA_INVALID',
                    'PASSWORD_MISMATCH',
                    'PASSWORD_TOO_SHORT',
                    'SETUP_ALREADY_COMPLETE',
                  ],
                },
                message: {
                  type: 'string',
                  description: '用户友好的错误消息',
                },
                details: {
                  type: 'string',
                  description: '技术细节（仅开发环境）',
                },
                requestId: {
                  type: 'string',
                  description: '请求追踪 ID',
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time',
                },
              },
              required: ['code', 'message', 'timestamp'],
            },
          },
        },
      },
    },
    security: [
      {
        cookieAuth: [],
      },
    ],
  },
  apis: [
    './src/auth/*.ts',
    './src/connections/*.ts',
    './src/sftp/*.ts',
    './src/batch/*.ts',
    './src/ai-ops/*.ts',
    './src/tags/*.ts',
    './src/proxies/*.ts',
    './src/settings/*.ts',
    './src/notifications/*.ts',
    './src/audit/*.ts',
    './src/command-history/*.ts',
    './src/quick-commands/*.ts',
    './src/quick-command-tags/*.ts',
    './src/terminal-themes/*.ts',
    './src/appearance/*.ts',
    './src/ssh-keys/*.ts',
    './src/transfers/*.ts',
    './src/path-history/*.ts',
    './src/favorite-paths/*.ts',
  ],
};

// 仅在开发环境按需构建 Swagger 文档，避免生产环境引入不必要运行时依赖
export const buildSwaggerSpec = () => {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const swaggerJsdoc = require('swagger-jsdoc') as (
    opts: typeof options,
  ) => Record<string, unknown>;
  return swaggerJsdoc(options);
};
