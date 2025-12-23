import express from 'express';
import * as QuickCommandTagController from './quick-command-tag.controller';
import { isAuthenticated } from '../auth/auth.middleware'; // 假设需要认证

const router = express.Router();

// 获取所有快捷指令标签
router.get('/', isAuthenticated, QuickCommandTagController.getAllQuickCommandTags);

// 添加新的快捷指令标签
router.post('/', isAuthenticated, QuickCommandTagController.addQuickCommandTag);

// 更新快捷指令标签
router.put('/:id', isAuthenticated, QuickCommandTagController.updateQuickCommandTag);

// 删除快捷指令标签
router.delete('/:id', isAuthenticated, QuickCommandTagController.deleteQuickCommandTag);

export default router;
