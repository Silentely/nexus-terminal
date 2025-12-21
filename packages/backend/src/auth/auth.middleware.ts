import { Request, Response, NextFunction } from 'express';

/**
 * 认证中间件：检查用户是否已登录 (通过 session 中的 userId 判断)
 */
export const isAuthenticated = (req: Request, res: Response, next: NextFunction): void => {
    if (req.session && req.session.userId) {
        // 用户已登录，继续处理请求
        next();
    } else {
        // 用户未登录，返回 401 未授权错误
        res.status(401).json({ message: '未授权：请先登录。' });
    }
};
