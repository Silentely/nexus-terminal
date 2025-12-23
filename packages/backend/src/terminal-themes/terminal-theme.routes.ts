import express from 'express';
import * as themeController from './terminal-theme.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = express.Router();

// 应用认证中间件到所有主题路由
router.use(isAuthenticated); // 修正使用的中间件名称

// GET /api/v1/terminal-themes - 获取所有主题
router.get('/', themeController.getAllThemesController);

// POST /api/v1/terminal-themes - 创建新主题
router.post('/', themeController.createThemeController);

// GET /api/v1/terminal-themes/:id - 获取单个主题
router.get('/:id', themeController.getThemeByIdController);

// PUT /api/v1/terminal-themes/:id - 更新主题
router.put('/:id', themeController.updateThemeController);

// DELETE /api/v1/terminal-themes/:id - 删除主题
router.delete('/:id', themeController.deleteThemeController);

// POST /api/v1/terminal-themes/import - 导入主题 (使用 multer 中间件处理文件)
router.post(
  '/import',
  themeController.uploadMiddleware.single('themeFile'),
  themeController.importThemeController
);

// GET /api/v1/terminal-themes/:id/export - 导出主题
router.get('/:id/export', themeController.exportThemeController);

export default router;
