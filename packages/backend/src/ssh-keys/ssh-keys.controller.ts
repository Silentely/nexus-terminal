import { Request, Response, NextFunction } from 'express';
import * as SshKeyService from './ssh-keys.service';
import { CreateSshKeyInput, UpdateSshKeyInput } from './ssh-keys.service';
import { ErrorFactory } from '../utils/AppError';

/**
 * 获取所有 SSH 密钥的名称列表 (GET /api/v1/ssh-keys)
 */
export const getSshKeyNames = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const keys = await SshKeyService.getAllSshKeyNames();
    res.status(200).json(keys);
  } catch (error) {
    console.error('Controller: 获取 SSH 密钥列表失败:', error);
    next(error);
  }
};

/**
 * 创建新的 SSH 密钥 (POST /api/v1/ssh-keys)
 */
export const createSshKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input: CreateSshKeyInput = req.body;
    // 基本验证，更详细的验证在 Service 层
    if (!input.name || !input.private_key) {
      res.status(400).json({ message: '请求体必须包含 name 和 private_key。' });
      return;
    }
    const newKey = await SshKeyService.createSshKey(input);
    res.status(201).json({ message: 'SSH 密钥创建成功。', key: newKey });
  } catch (error: any) {
    console.error('Controller: 创建 SSH 密钥失败:', error);
    // 检查是否是 Service 层抛出的特定错误 (如名称重复)
    if (error.message.includes('已存在') || error.message.includes('必须提供')) {
      res.status(400).json({ message: error.message });
    } else {
      next(error);
    }
  }
};

/**
 * 获取单个 SSH 密钥的详细信息 (包含解密后的凭证) - 谨慎使用，可能主要用于编辑回显
 * (GET /api/v1/ssh-keys/:id/details) - 使用不同的路径以示区分
 */
export const getDecryptedSshKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const keyId = parseInt(req.params.id, 10);
    if (isNaN(keyId)) {
      res.status(400).json({ message: '无效的密钥 ID。' });
      return;
    }
    const keyDetails = await SshKeyService.getDecryptedSshKeyById(keyId);
    if (!keyDetails) {
      res.status(404).json({ message: 'SSH 密钥未找到。' });
    } else {
      // 返回解密后的数据，前端需要妥善处理
      res.status(200).json(keyDetails);
    }
  } catch (error) {
    console.error(`Controller: 获取解密后的 SSH 密钥 ${req.params.id} 失败:`, error);
    next(error);
  }
};

/**
 * 更新 SSH 密钥 (PUT /api/v1/ssh-keys/:id)
 */
export const updateSshKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const keyId = parseInt(req.params.id, 10);
    if (isNaN(keyId)) {
      res.status(400).json({ message: '无效的密钥 ID。' });
      return;
    }
    const input: UpdateSshKeyInput = req.body;
    // 简单验证输入是否为空对象
    if (Object.keys(input).length === 0) {
      res.status(400).json({ message: '请求体不能为空。' });
      return;
    }

    const updatedKey = await SshKeyService.updateSshKey(keyId, input);
    if (!updatedKey) {
      res.status(404).json({ message: 'SSH 密钥未找到。' });
    } else {
      res.status(200).json({ message: 'SSH 密钥更新成功。', key: updatedKey });
    }
  } catch (error: any) {
    console.error(`Controller: 更新 SSH 密钥 ${req.params.id} 失败:`, error);
    // 检查是否是 Service 层抛出的特定错误 (如名称重复或验证失败)
    if (error.message.includes('已存在') || error.message.includes('不能为空')) {
      res.status(400).json({ message: error.message });
    } else {
      next(error);
    }
  }
};

/**
 * 删除 SSH 密钥 (DELETE /api/v1/ssh-keys/:id)
 */
export const deleteSshKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const keyId = parseInt(req.params.id, 10);
    if (isNaN(keyId)) {
      res.status(400).json({ message: '无效的密钥 ID。' });
      return;
    }
    const deleted = await SshKeyService.deleteSshKey(keyId);
    if (!deleted) {
      res.status(404).json({ message: 'SSH 密钥未找到。' });
    } else {
      res.status(200).json({ message: 'SSH 密钥删除成功。' });
    }
  } catch (error) {
    console.error(`Controller: 删除 SSH 密钥 ${req.params.id} 失败:`, error);
    next(error);
  }
};
