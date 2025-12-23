import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import {
  getSshKeyNames,
  createSshKey,
  getDecryptedSshKey,
  updateSshKey,
  deleteSshKey,
} from './ssh_keys.controller';

const router = Router();

// 应用认证中间件到所有 /ssh-keys 路由
router.use(isAuthenticated);

// GET /api/v1/ssh-keys - 获取所有 SSH 密钥的名称列表
router.get('/', getSshKeyNames);

// POST /api/v1/ssh-keys - 创建新的 SSH 密钥
router.post('/', createSshKey);

// GET /api/v1/ssh-keys/:id/details - 获取单个解密后的 SSH 密钥详情 (谨慎使用)
router.get('/:id/details', getDecryptedSshKey);

// PUT /api/v1/ssh-keys/:id - 更新 SSH 密钥
router.put('/:id', updateSshKey);

// DELETE /api/v1/ssh-keys/:id - 删除 SSH 密钥
router.delete('/:id', deleteSshKey);

export default router;
