import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { isAuthenticated } from '../auth/auth.middleware';
import {
  createConnection,
  getConnections,
  getConnectionById,
  updateConnection,
  deleteConnection,
  testConnection,
  testUnsavedConnection,
  exportConnections,
  importConnections,
  getRdpSessionToken,
  getVncSessionToken,
  cloneConnection,
  addTagToConnections,
} from './connections.controller';

const router = Router();

// 配置 multer 用于处理 JSON 文件上传 (存储在内存中)
const storage = multer.memoryStorage(); // 将文件存储在内存中作为 Buffer
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 限制文件大小为 5MB
  fileFilter: (req: Request, file, cb) => {
    if (file.mimetype === 'application/json') {
      cb(null, true);
    } else {
      (req as any).fileValidationError = '只允许上传 JSON 文件！';
      cb(null, false);
    }
  },
});

// 应用认证中间件到所有 /connections 路由
router.use(isAuthenticated); // 恢复认证检查

// GET /api/v1/connections/export - 导出连接配置
router.get('/export', exportConnections);

// POST /api/v1/connections/import - 导入连接配置
router.post(
  '/import',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('connectionsFile')(req, res, (err: any) => {
      if ((req as any).fileValidationError) {
        return res.status(400).json({ message: (req as any).fileValidationError });
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: `文件上传错误: ${err.message}` });
      }
      if (err) {
        console.error('Unexpected error during file upload:', err);
        return res.status(500).json({ message: '文件上传处理失败' });
      }
      next();
    });
  },
  importConnections
);

// GET /api/v1/connections - 获取连接列表
router.get('/', getConnections);

// POST /api/v1/connections - 创建新连接
router.post('/', createConnection);

// GET /api/v1/connections/:id - 获取单个连接信息
router.get('/:id', getConnectionById);

// PUT /api/v1/connections/:id - 更新连接信息
router.put('/:id', updateConnection);

// DELETE /api/v1/connections/:id - 删除连接
router.delete('/:id', deleteConnection);

// POST /api/v1/connections/:id/test - 测试连接
router.post('/:id/test', testConnection);

// POST /api/v1/connections/test-unsaved - 测试未保存的连接信息
router.post('/test-unsaved', testUnsavedConnection);

// POST /api/v1/connections/:id/rdp-session - Get RDP session token via backend
router.post('/:id/rdp-session', getRdpSessionToken);

// POST /api/v1/connections/:id/vnc-session - Get VNC session token
router.post('/:id/vnc-session', getVncSessionToken);

// +++ POST /api/v1/connections/:id/clone - 克隆连接 +++
router.post('/:id/clone', cloneConnection);

// +++ POST /api/v1/connections/add-tag - 为多个连接添加一个标签 +++
router.post('/add-tag', addTagToConnections);

// Note: PUT /:id/tags route is removed as the primary flow uses the bulk add endpoint now.
// It could be kept if there's a separate use case for updating a single connection's tags.

export default router;
