import express from 'express';
import * as appearanceController from './appearance.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = express.Router();

// 应用认证中间件
router.use(isAuthenticated);

// GET /api/v1/appearance - 获取所有外观设置
router.get('/', appearanceController.getAppearanceSettingsController);

// PUT /api/v1/appearance - 更新外观设置 (文本类)
router.put('/', appearanceController.updateAppearanceSettingsController);

// POST /api/v1/appearance/background/page - 上传页面背景图片
router.post(
  '/background/page',
  appearanceController.uploadPageBackgroundMiddleware,
  appearanceController.uploadPageBackgroundController
);

// POST /api/v1/appearance/background/terminal - 上传终端背景图片
router.post(
  '/background/terminal',
  appearanceController.uploadTerminalBackgroundMiddleware,
  appearanceController.uploadTerminalBackgroundController
);

// GET /api/v1/appearance/background/file/:filename - 获取背景图片文件
router.get('/background/file/:filename', appearanceController.getBackgroundFileController);

// DELETE /api/v1/appearance/background/page - 删除页面背景图片
router.delete('/background/page', appearanceController.removePageBackgroundController);

// DELETE /api/v1/appearance/background/terminal - 删除终端背景图片
router.delete('/background/terminal', appearanceController.removeTerminalBackgroundController);

// HTML 预设主题相关路由 /api/v1/appearance/html-presets
const htmlPresetsRouter = express.Router();

// 本地 HTML 主题接口 /api/v1/appearance/html-presets/local
htmlPresetsRouter.get('/local', appearanceController.listLocalHtmlPresetsController);
htmlPresetsRouter.get(
  '/local/:themeName',
  appearanceController.getLocalHtmlPresetContentController
);
htmlPresetsRouter.post('/local', appearanceController.createLocalHtmlPresetController);
htmlPresetsRouter.put('/local/:themeName', appearanceController.updateLocalHtmlPresetController);
htmlPresetsRouter.delete('/local/:themeName', appearanceController.deleteLocalHtmlPresetController);

// 远程 GitHub HTML 主题接口 /api/v1/appearance/html-presets/remote
htmlPresetsRouter.get(
  '/remote/repository-url',
  appearanceController.getRemoteHtmlPresetsRepositoryUrlController
);
htmlPresetsRouter.put(
  '/remote/repository-url',
  appearanceController.updateRemoteHtmlPresetsRepositoryUrlController
);
htmlPresetsRouter.get('/remote/list', appearanceController.listRemoteHtmlPresetsController);
htmlPresetsRouter.get('/remote/content', appearanceController.getRemoteHtmlPresetContentController);

router.use('/html-presets', htmlPresetsRouter);

export default router;
