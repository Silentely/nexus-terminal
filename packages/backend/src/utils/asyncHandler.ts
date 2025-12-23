/**
 * P1-6: 异步路由处理器包装函数
 * 用于自动捕获异步 controller 中的错误并传递给全局错误处理中间件
 */

import { Request, Response, NextFunction } from 'express';

/**
 * 异步处理器类型定义
 */
type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * 包装异步路由处理器
 * 自动捕获 Promise rejection 并传递给 next()
 *
 * @param fn 异步路由处理函数
 * @returns Express 中间件函数
 *
 * @example
 * // 使用方式
 * router.get('/example', asyncHandler(async (req, res, next) => {
 *   const data = await someAsyncOperation();
 *   res.json(data);
 * }));
 */
export const asyncHandler = (fn: AsyncRequestHandler) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
