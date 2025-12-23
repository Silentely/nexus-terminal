import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import { downloadFile, downloadDirectory } from './sftp.controller'; // +++ 导入 downloadDirectory +++

const router = Router();

// 应用认证中间件
router.use(isAuthenticated);

// GET /api/v1/sftp/download?connectionId=...&remotePath=...
router.get('/download', downloadFile);

// +++ GET /api/v1/sftp/download-directory?connectionId=...&remotePath=... +++
router.get('/download-directory', downloadDirectory);

export default router;
