# OpenAPI/Swagger 文档使用指南

## 概述

星枢终端后端 API 使用 OpenAPI 3.0 规范和 Swagger UI 提供交互式 API 文档。

## 访问文档

### 开发环境

启动开发服务器后，访问：

```
http://localhost:3001/api-docs
```

### 生产环境

Docker 部署后，访问：

```
http://localhost:18111/api-docs
```

## 功能特性

### ✨ 交互式 API 测试

- 📝 **在线测试**：直接在浏览器中测试 API 端点
- 🔐 **自动认证**：登录后自动携带 Session Cookie
- 📊 **实时响应**：查看完整的请求和响应数据
- 🎯 **参数验证**：自动验证请求参数格式

### 📚 完整的 API 文档

- **请求参数**：详细的参数类型、约束和示例
- **响应格式**：标准化的响应结构和错误处理
- **认证说明**：Session Cookie 的使用方式
- **错误代码**：完整的错误代码说明和处理建议

### 🏷️ API 分类

所有 API 按功能分组：

| 标签              | 描述                 |
| ----------------- | -------------------- |
| `auth`            | 用户认证与授权       |
| `connections`     | SSH/RDP/VNC 连接管理 |
| `sftp`            | SFTP 文件操作        |
| `batch`           | 批量命令执行         |
| `ai-ops`          | AI 智能运维分析      |
| `tags`            | 连接标签管理         |
| `proxies`         | 代理配置管理         |
| `settings`        | 系统设置             |
| `notifications`   | 通知渠道配置         |
| `audit`           | 审计日志查询         |
| `command-history` | 命令历史记录         |
| `quick-commands`  | 快捷指令管理         |
| `terminal-themes` | 终端主题配置         |
| `appearance`      | 外观设置             |
| `ssh-keys`        | SSH 密钥管理         |
| `transfers`       | 文件传输状态         |
| `path-history`    | 路径浏览历史         |
| `favorite-paths`  | 收藏路径管理         |

## 使用步骤

### 1. 认证流程

由于 API 使用 Session Cookie 认证，需要先登录：

1. 展开 **auth** 标签
2. 找到 `POST /api/v1/auth/login`
3. 点击 **Try it out**
4. 输入用户名和密码：
   ```json
   {
     "username": "admin",
     "password": "your_password"
   }
   ```
5. 点击 **Execute**
6. 登录成功后，浏览器会自动保存 Session Cookie

### 2. 测试 API

登录后，所有需要认证的 API 都会自动使用 Session Cookie：

1. 选择要测试的 API 端点
2. 点击 **Try it out**
3. 填写必需的请求参数
4. 点击 **Execute** 发送请求
5. 查看响应数据和状态码

### 3. 查看响应示例

每个 API 端点都提供了：

- **成功响应**：200/201 状态码的响应格式
- **错误响应**：400/401/403/404/422/500 等错误格式
- **Schema 定义**：详细的数据结构说明

## 示例：测试批量命令执行

### 创建批量任务

```http
POST /api/v1/batch
Content-Type: application/json

{
  "command": "ls -la /home",
  "connectionIds": [1, 2, 3],
  "concurrencyLimit": 5,
  "timeoutSeconds": 60
}
```

### 查询任务状态

```http
GET /api/v1/batch/{taskId}
```

### 取消任务

```http
POST /api/v1/batch/{taskId}/cancel
Content-Type: application/json

{
  "reason": "用户取消"
}
```

## 为新 API 添加文档

### JSDoc 注释格式

在路由文件中使用 JSDoc 格式的 Swagger 注释：

```typescript
/**
 * @swagger
 * /api/v1/example:
 *   post:
 *     summary: API 简短描述
 *     description: 详细描述
 *     tags: [category-name]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - field1
 *             properties:
 *               field1:
 *                 type: string
 *                 description: 字段说明
 *                 example: "示例值"
 *     responses:
 *       200:
 *         description: 成功响应
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: 未授权
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/example', exampleController);
```

### 关键要素

1. **路径**：`/api/v1/...`（完整路径）
2. **HTTP 方法**：`get`, `post`, `put`, `delete`
3. **标签**：用于分组（必须在 `swagger.config.ts` 中定义）
4. **参数**：
   - `parameters`：查询参数、路径参数
   - `requestBody`：请求体
5. **响应**：
   - 至少定义 `200` 和错误响应
   - 使用 `$ref: '#/components/schemas/Error'` 引用标准错误格式

### 参考示例

项目中已有完整的文档示例：

- **auth.routes.ts**：认证相关 API（login, logout, status, password）
- **batch.routes.ts**：批量操作 API（完整的 5 个端点）

## 标准错误响应

所有 API 错误响应使用统一格式（由 P1-6 错误处理中间件提供）：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "用户友好的错误消息",
    "details": "技术细节（仅开发环境）",
    "requestId": "a1b2c3d4e5f6",
    "timestamp": "2025-12-23T10:30:00.000Z"
  }
}
```

### 常见错误代码

| 代码                    | HTTP 状态码 | 说明             |
| ----------------------- | ----------- | ---------------- |
| `BAD_REQUEST`           | 400         | 请求参数错误     |
| `UNAUTHORIZED`          | 401         | 未登录或认证失败 |
| `FORBIDDEN`             | 403         | 无权访问         |
| `NOT_FOUND`             | 404         | 资源不存在       |
| `VALIDATION_ERROR`      | 422         | 数据验证失败     |
| `INTERNAL_SERVER_ERROR` | 500         | 服务器内部错误   |
| `DATABASE_ERROR`        | 500         | 数据库操作失败   |
| `SERVICE_UNAVAILABLE`   | 503         | 服务暂时不可用   |

## 配置文件

### swagger.config.ts

定义 OpenAPI 规范：

- **info**：API 基本信息（标题、版本、描述）
- **servers**：服务器地址列表
- **tags**：API 分类标签
- **components**：可复用的 Schema 定义
- **apis**：扫描 JSDoc 注释的文件路径

### index.ts

注册 Swagger UI 中间件：

```typescript
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.config';

app.use('/api-docs', swaggerUi.serve);
app.get(
  '/api-docs',
  swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: '星枢终端 API 文档',
  })
);
```

## 技术栈

- **swagger-jsdoc**：从 JSDoc 注释生成 OpenAPI 规范
- **swagger-ui-express**：提供 Swagger UI 界面
- **OpenAPI 3.0**：API 规范标准

## 最佳实践

### ✅ 推荐做法

1. **详细的描述**：为每个参数和响应提供清晰的说明
2. **示例值**：使用 `example` 字段提供实际的示例
3. **错误处理**：列出所有可能的错误响应
4. **引用 Schema**：使用 `$ref` 避免重复定义
5. **分组清晰**：使用合适的 `tags` 分类
6. **保持更新**：代码变更时同步更新文档

### ❌ 避免做法

1. 文档与实际 API 不一致
2. 缺少必需参数的说明
3. 错误响应定义不完整
4. 缺少示例值
5. 标签混乱或重复

## 相关文件

- `src/config/swagger.config.ts` - OpenAPI 配置
- `src/index.ts` - Swagger UI 路由注册
- `src/auth/auth.routes.ts` - 认证 API 文档示例
- `src/batch/batch.routes.ts` - 批量操作 API 文档示例
- `src/docs/ERROR_HANDLING_GUIDE.md` - 错误处理指南（P1-6）

---

**文档生成时间**：2025-12-23
**相关任务**：工具链 - 添加 OpenAPI/Swagger 文档
