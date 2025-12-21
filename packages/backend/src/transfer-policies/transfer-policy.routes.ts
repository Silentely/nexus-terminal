import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import {
    getPolicyList,
    getPolicyById,
    createPolicy,
    updatePolicy,
    deletePolicy,
    validateTransfer,
    getEffectivePolicies
} from './transfer-policy.controller';

const router = Router();

// 应用认证中间件
router.use(isAuthenticated);

// 任何登录用户可访问
// GET /api/v1/transfer-policies - 获取策略列表
router.get('/', getPolicyList);

// GET /api/v1/transfer-policies/effective - 获取当前用户的有效策略
router.get('/effective', getEffectivePolicies);

// GET /api/v1/transfer-policies/:id - 获取单个策略
router.get('/:id', getPolicyById);

// POST /api/v1/transfer-policies/validate - 验证传输请求（用于 SFTP 服务调用）
router.post('/validate', validateTransfer);

// POST /api/v1/transfer-policies - 创建策略
router.post('/', createPolicy);

// PUT /api/v1/transfer-policies/:id - 更新策略
router.put('/:id', updatePolicy);

// DELETE /api/v1/transfer-policies/:id - 删除策略
router.delete('/:id', deletePolicy);

export default router;
