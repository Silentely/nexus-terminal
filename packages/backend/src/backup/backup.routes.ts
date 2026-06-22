/**
 * 数据备份 API 路由
 * POST /api/v1/backup/export  导出所有核心数据
 * POST /api/v1/backup/import  导入备份数据
 * POST /api/v1/backup/validate 验证备份文件格式
 */

import express, { Router, Request, Response } from 'express';
import { exportData, importData, validateBackup } from './backup.service';
import { isAuthenticated } from '../auth/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();

/** 导入端点专用的 body 解析器（备份文件可能超过全局 1mb 限制） */
const importBodyParser = express.json({ limit: '5mb' });

/**
 * 导出数据
 * 响应：JSON 格式的完整备份数据（含元信息）
 */
router.post('/export', isAuthenticated, async (_req: Request, res: Response) => {
  try {
    const backup = await exportData();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nexus-terminal-backup-${Date.now()}.json"`,
    );
    // 流式输出：res.write 直接写入网络流，跳过 Express res.json 的内部缓冲
    res.write(JSON.stringify(backup));
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '导出失败';
    logger.error('[Backup] 导出失败:', message);
    res.status(500).json({ message: '数据导出失败', error: message });
  }
});

/**
 * 导入数据
 * 请求体：{ data: BackupPayload, overwrite?: boolean, tables?: string[] }
 */
router.post('/import', isAuthenticated, importBodyParser, async (req: Request, res: Response) => {
  try {
    const { data, overwrite, tables } = req.body;

    if (!data) {
      res.status(400).json({ message: '缺少备份数据' });
      return;
    }

    const validation = validateBackup(data);
    if (!validation.valid) {
      res.status(400).json({ message: '备份数据验证失败', error: validation.error });
      return;
    }

    const result = await importData(data, { overwrite, tables });
    const hasErrors = result.errors.length > 0;
    res.status(hasErrors ? 207 : 200).json({
      message: hasErrors ? '导入完成但存在错误，事务已回滚' : '导入完成',
      result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '导入失败';
    logger.error('[Backup] 导入失败:', message);
    res.status(500).json({ message: '数据导入失败', error: message });
  }
});

/**
 * 验证备份文件格式
 * 请求体：完整的备份 JSON 对象
 */
router.post('/validate', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const result = validateBackup(req.body);
    if (result.valid) {
      res.json({ message: '备份数据验证通过', metadata: result.metadata });
    } else {
      res.status(400).json({ message: '备份数据验证失败', error: result.error });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '验证失败';
    res.status(500).json({ message: '备份数据验证失败', error: message });
  }
});

export default router;
