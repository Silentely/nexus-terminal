import { Router } from 'express';
import { DockerController } from './docker.controller';
// 修改导入路径
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();
const dockerController = new DockerController();

// 应用认证中间件，确保只有登录用户才能访问 Docker 相关接口
router.use(isAuthenticated);

// GET /api/docker/status - 获取 Docker 容器状态
router.get('/status', (req, res, next) => dockerController.getStatus(req, res, next));

// POST /api/docker/command - 执行 Docker 命令
router.post('/command', (req, res, next) => dockerController.executeCommand(req, res, next));

export default router;
