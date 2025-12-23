import { Router } from 'express';
import * as PathHistoryController from './path-history.controller';
import { isAuthenticated } from '../auth/auth.middleware'; // 更新认证中间件

const router = Router();

// 应用认证中间件到所有路径历史路由
router.use(isAuthenticated);

router.post('/', PathHistoryController.addPath);
router.get('/', PathHistoryController.getAllPaths);
router.delete('/:id', PathHistoryController.deletePath);
router.delete('/', PathHistoryController.clearAllPaths); // 更新清空路由

export default router;
