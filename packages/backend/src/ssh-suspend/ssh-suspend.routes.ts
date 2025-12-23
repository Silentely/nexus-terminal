import express from 'express';
import { SshSuspendController } from './ssh-suspend.controller';
import { isAuthenticated } from '../auth/auth.middleware'; // 取消注释：如果需要认证

const router = express.Router();
const sshSuspendController = new SshSuspendController();

// 定义获取挂起 SSH 会话列表的路由
// 路径将是 /api/v1/ssh-suspend/suspended-sessions (因为基础路径是 /api/v1/ssh-suspend)
router.get(
  '/suspended-sessions',
  isAuthenticated, // 取消注释：添加认证中间件
  sshSuspendController.getSuspendedSshSessions
);

// Route to terminate an active 'hanging' suspended session and remove its entry
router.delete(
  '/terminate/:suspendSessionId',
  isAuthenticated,
  sshSuspendController.terminateAndRemoveSession
);

// Route to remove an already 'disconnected_by_backend' suspended session entry
router.delete('/entry/:suspendSessionId', isAuthenticated, sshSuspendController.removeSessionEntry);

// Route to edit a suspended session's custom name
router.put(
  '/name/:suspendSessionId',
  isAuthenticated,
  sshSuspendController.editSessionNameHttp // 新的控制器方法
);

// Route to export the log of a suspended session
router.get('/log/:suspendSessionId', isAuthenticated, sshSuspendController.exportSessionLog);

export default router;
