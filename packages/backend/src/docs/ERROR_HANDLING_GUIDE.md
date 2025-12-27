# 标准化错误处理指南 (P1-6)

## 概述

本项目已实施标准化的错误处理系统,用于：

- ✅ 避免泄露敏感技术细节
- ✅ 统一错误响应格式
- ✅ 简化 Controller 层代码
- ✅ 自动记录错误日志（已脱敏）

## 核心组件

### 1. 错误类型定义 (`types/error.types.ts`)

```typescript
export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST', // 400
  UNAUTHORIZED = 'UNAUTHORIZED', // 401
  FORBIDDEN = 'FORBIDDEN', // 403
  NOT_FOUND = 'NOT_FOUND', // 404
  VALIDATION_ERROR = 'VALIDATION_ERROR', // 422
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR', // 500
  DATABASE_ERROR = 'DATABASE_ERROR', // 500
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE', // 503
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string; // 用户友好的错误消息
    details?: string; // 仅开发环境返回
    requestId?: string; // 请求追踪 ID
    timestamp: string; // ISO 8601 时间戳
  };
}
```

### 2. 自定义错误类 (`utils/AppError.ts`)

```typescript
import { AppError, ErrorFactory } from '../utils/AppError';

// 方式 1: 直接使用 ErrorFactory（推荐）
throw ErrorFactory.badRequest('参数错误');
throw ErrorFactory.unauthorized('用户未登录');
throw ErrorFactory.forbidden('无权访问');
throw ErrorFactory.notFound('资源未找到');
throw ErrorFactory.validationError('验证失败');
throw ErrorFactory.internalError('服务器错误');
throw ErrorFactory.databaseError('数据库操作失败');

// 方式 2: 使用 AppError 构造器（需要更多控制时）
throw new AppError(
  '自定义错误消息',
  ErrorCode.BAD_REQUEST,
  400,
  ErrorSeverity.LOW,
  true,
  '技术细节（仅记录到日志）'
);
```

### 3. 全局错误处理中间件 (`middleware/error.middleware.ts`)

已在 `index.ts` 中自动注册，无需手动配置。

### 4. 异步处理器包装器 (`utils/asyncHandler.ts`)

**注意**：由于 Express 5.x 原生支持异步路由处理器，本工具主要用于兼容性考虑。

```typescript
import { asyncHandler } from '../utils/asyncHandler';

// 可选使用（Express 5.x 已内置支持）
router.get(
  '/example',
  asyncHandler(async (req, res, next) => {
    const data = await someAsyncOperation();
    res.json(data);
  })
);
```

## 使用示例

### ❌ 旧方式（不推荐）

```typescript
// 旧代码 - 不安全且冗余
export const getUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.id;

    if (!userId) {
      res.status(400).json({ message: '用户 ID 缺失' });
      return;
    }

    const user = await UserService.findById(userId);

    if (!user) {
      res.status(404).json({ message: '用户未找到' });
      return;
    }

    res.status(200).json(user);
  } catch (error: any) {
    console.error('获取用户失败:', error);
    // ⚠️ 危险：泄露技术细节！
    res.status(500).json({ message: error.message, stack: error.stack });
  }
};
```

### ✅ 新方式（推荐）

```typescript
import { Request, Response, NextFunction } from 'express';
import { ErrorFactory } from '../utils/AppError';

// 新代码 - 安全、简洁、标准化
export const getUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.params.id;

    if (!userId) {
      throw ErrorFactory.validationError('用户 ID 缺失');
    }

    const user = await UserService.findById(userId);

    if (!user) {
      throw ErrorFactory.notFound('用户未找到');
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error); // 传递给全局错误处理中间件
  }
};
```

### 完整示例 (参考 `batch.controller.ts`)

```typescript
import { Request, Response, NextFunction } from 'express';
import { ErrorFactory } from '../utils/AppError';

/**
 * 获取当前用户 ID（辅助函数）
 */
function getUserId(req: Request): number {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    throw ErrorFactory.unauthorized('用户未登录');
  }
  return userId;
}

/**
 * 创建任务 (POST /api/v1/tasks)
 */
export const createTask = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { name, description } = req.body;

    // 参数验证
    if (!name || typeof name !== 'string') {
      throw ErrorFactory.validationError('任务名称不能为空');
    }

    // 调用 Service 层
    const task = await TaskService.create({ name, description, userId });

    // 成功响应
    res.status(201).json({
      success: true,
      message: '任务创建成功',
      task,
    });
  } catch (error) {
    next(error); // 传递给全局错误处理中间件
  }
};

/**
 * 获取任务详情 (GET /api/v1/tasks/:id)
 */
export const getTaskById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getUserId(req);
    const taskId = parseInt(req.params.id, 10);

    if (isNaN(taskId)) {
      throw ErrorFactory.validationError('无效的任务 ID');
    }

    const task = await TaskService.findById(taskId);

    if (!task) {
      throw ErrorFactory.notFound('任务不存在');
    }

    // 权限检查
    if (task.userId !== userId) {
      throw ErrorFactory.forbidden('无权访问此任务');
    }

    res.status(200).json({ success: true, task });
  } catch (error) {
    next(error);
  }
};
```

## Service 层错误处理

Service 层应该抛出 AppError，而不是直接返回错误响应：

```typescript
// ❌ 错误做法
export const findUserById = async (id: number) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    return { success: true, user };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// ✅ 正确做法
import { ErrorFactory } from '../utils/AppError';

export const findUserById = async (id: number) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    return user;
  } catch (error: any) {
    // 将数据库错误转换为应用错误
    throw ErrorFactory.databaseError(
      '查询用户失败',
      `Database error: ${error.message}` // 技术细节仅记录到日志
    );
  }
};
```

## 响应格式示例

### 成功响应

```json
{
  "success": true,
  "message": "操作成功",
  "data": {
    /* ... */
  }
}
```

### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数验证失败",
    "requestId": "a1b2c3d4e5f6",
    "timestamp": "2025-12-23T10:30:00.000Z"
  }
}
```

### 开发环境错误响应（包含技术细节）

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_ERROR",
    "message": "数据库操作失败",
    "details": "SQLITE_ERROR: no such table: users",
    "requestId": "a1b2c3d4e5f6",
    "timestamp": "2025-12-23T10:30:00.000Z"
  }
}
```

## 错误日志示例

```
[2025-12-23 10:30:00 UTC] [ERROR] [ErrorHandler] [HIGH] Request ID: a1b2c3d4e5f6
[2025-12-23 10:30:00 UTC] [ERROR] [ErrorHandler] Path: GET /api/v1/users/123
[2025-12-23 10:30:00 UTC] [ERROR] [ErrorHandler] User: john_doe
[2025-12-23 10:30:00 UTC] [ERROR] [ErrorHandler] Error Code: DATABASE_ERROR
[2025-12-23 10:30:00 UTC] [ERROR] [ErrorHandler] Message: 数据库操作失败
[2025-12-23 10:30:00 UTC] [ERROR] [ErrorHandler] Technical Details: SQLITE_ERROR: no such table: users
[2025-12-23 10:30:00 UTC] [ERROR] [ErrorHandler] Stack Trace:
Error: 数据库操作失败
    at UserRepository.findById (/app/src/repositories/user.repository.ts:45:11)
    at UserService.getUser (/app/src/services/user.service.ts:23:7)
    ...
```

## 迁移清单

对于现有 Controller，请按以下步骤迁移：

1. ✅ 导入 `ErrorFactory` 和 `NextFunction`
2. ✅ 在函数签名中添加 `next: NextFunction` 参数
3. ✅ 将所有 `res.status().json({ message: ... })` 替换为 `throw ErrorFactory.xxx()`
4. ✅ 在 catch 块中调用 `next(error)` 而不是直接返回响应
5. ✅ 删除 `console.error` 语句（错误处理中间件会自动记录）
6. ✅ 确保成功响应使用 `{ success: true, ... }` 格式

## 安全收益

- ✅ **防止信息泄露**：技术细节（堆栈跟踪、SQL 查询、内部路径）仅记录到日志，不返回给客户端
- ✅ **统一响应格式**：所有错误响应遵循相同的 JSON 结构
- ✅ **请求追踪**：每个错误响应包含唯一的 `requestId` 用于日志关联
- ✅ **自动脱敏**：结合 P1-5 的日志脱敏功能，敏感信息不会出现在日志中
- ✅ **环境感知**：生产环境隐藏技术细节，开发环境提供完整信息

## 常见问题

### Q: 是否需要使用 `asyncHandler`？

A: Express 5.x 原生支持异步路由处理器，通常不需要。但如果遇到异步错误未被捕获的情况，可以使用 `asyncHandler` 包装。

### Q: Service 层抛出的 Error 会被正确处理吗？

A: 会！错误处理中间件会自动将普通 Error 转换为标准化的错误响应（状态码 500）。

### Q: 如何在 WebSocket 中使用标准化错误？

A: WebSocket 无法使用 Express 中间件。请直接使用 `ErrorFactory` 创建错误对象，然后通过 WebSocket 发送 JSON 响应。

### Q: 如何自定义错误代码？

A: 在 `types/error.types.ts` 的 `ErrorCode` 枚举中添加新代码，然后在 `ErrorFactory` 中添加相应的工厂方法。

## 相关文件

- `types/error.types.ts` - 错误类型定义
- `utils/AppError.ts` - 自定义错误类和工厂
- `middleware/error.middleware.ts` - 全局错误处理中间件
- `utils/asyncHandler.ts` - 异步处理器包装器（可选）
- `index.ts` - 中间件注册
- `batch/batch.controller.ts` - 完整示例

---

**实施日期**: 2025-12-23
**相关任务**: P1-6 标准化错误消息处理
