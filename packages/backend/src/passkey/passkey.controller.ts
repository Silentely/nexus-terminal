/**
 * Passkey 管理控制器
 * 处理 Passkey 的独立 CRUD 操作（与认证流程分离）
 *
 * 注册 / 认证流程仍保留在 auth/ 模块中（auth-passkey.handlers.ts）
 */

import { Request, Response, NextFunction } from 'express';
import { passkeyService } from './passkey.service';
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import eventService, { AppEventType } from '../services/event.service';

const auditLogService = new AuditLogService();
const notificationService = new NotificationService();

/**
 * 从请求会话中解析已认证用户，未登录则返回 null
 */
function resolveAuthenticatedUser(req: Request): { userId: number; username: string } | null {
  const userId = req.session?.userId;
  const username = req.session?.username;
  if (!userId || !username) return null;
  return { userId, username };
}

/**
 * 获取当前用户的所有 Passkey (GET /api/v1/passkey)
 * 返回列表仅包含非敏感字段（credential_id, created_at, last_used_at, transports, name）
 */
export const listUserPasskeys = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const actor = resolveAuthenticatedUser(req);
  if (!actor) {
    res.status(401).json({ message: '未登录。' });
    return;
  }

  try {
    const passkeys = await passkeyService.listPasskeysByUserId(actor.userId);
    logger.debug(`[Passkey] 用户 ${actor.username} 获取 Passkey 列表，共 ${passkeys.length} 个`);
    res.status(200).json(passkeys);
  } catch (error: unknown) {
    logger.error(error as Error, `[Passkey] 获取用户 ${actor.username} Passkey 列表失败`);
    next(error);
  }
};

/**
 * 删除当前用户指定的 Passkey (DELETE /api/v1/passkey/:credentialID)
 */
export const deleteUserPasskey = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const actor = resolveAuthenticatedUser(req);
  if (!actor) {
    res.status(401).json({ message: '未登录。' });
    return;
  }

  const { credentialID } = req.params;
  if (!credentialID) {
    res.status(400).json({ message: '缺少 credentialID 参数。' });
    return;
  }

  try {
    const wasDeleted = await passkeyService.deletePasskey(actor.userId, credentialID);
    if (wasDeleted) {
      logger.info(`[Passkey] 用户 ${actor.username} 删除 Passkey 成功: ${credentialID}`);
      auditLogService.logAction('PASSKEY_DELETED', {
        userId: actor.userId,
        credentialId: credentialID,
      });
      notificationService.sendNotification('PASSKEY_DELETED', {
        userId: actor.userId,
        username: actor.username,
        credentialId: credentialID,
      });
      eventService.emitEvent(AppEventType.PasskeyDeleted, {
        userId: actor.userId,
        details: { username: actor.username, passkeyId: credentialID },
      });
      res.status(200).json({ message: 'Passkey 已成功删除。' });
    } else {
      res.status(404).json({ message: 'Passkey 未找到或删除失败。' });
    }
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    logger.error(
      error as Error,
      `[Passkey] 用户 ${actor.username} 删除 Passkey 失败: ${credentialID}`,
    );
    if (errMsg.includes('Unauthorized')) {
      auditLogService.logAction('PASSKEY_DELETE_UNAUTHORIZED', {
        userId: actor.userId,
        username: actor.username,
        credentialIdAttempted: credentialID,
      });
      res.status(403).json({ message: '无权删除此 Passkey。' });
    } else if (errMsg.includes('not found')) {
      res.status(404).json({ message: 'Passkey 未找到。' });
    } else {
      next(error);
    }
  }
};

/**
 * 更新当前用户指定的 Passkey 名称 (PUT /api/v1/passkey/:credentialID/name)
 */
export const updateUserPasskeyName = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const actor = resolveAuthenticatedUser(req);
  if (!actor) {
    res.status(401).json({ message: '未登录。' });
    return;
  }

  const { credentialID } = req.params;
  const { name } = req.body;

  if (!credentialID) {
    res.status(400).json({ message: '缺少 credentialID 参数。' });
    return;
  }
  if (!name || typeof name !== 'string') {
    res.status(400).json({ message: '请提供有效的 Passkey 名称。' });
    return;
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    res.status(400).json({ message: 'Passkey 名称不能为空。' });
    return;
  }

  try {
    await passkeyService.updatePasskeyName(actor.userId, credentialID, trimmedName);
    logger.info(
      `[Passkey] 用户 ${actor.username} 更新 Passkey 名称成功: ${credentialID} -> ${trimmedName}`,
    );
    auditLogService.logAction('PASSKEY_NAME_UPDATED', {
      userId: actor.userId,
      credentialId: credentialID,
      newName: trimmedName,
    });
    res.status(200).json({ message: 'Passkey 名称更新成功。' });
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    logger.error(
      error as Error,
      `[Passkey] 用户 ${actor.username} 更新 Passkey 名称失败: ${credentialID}`,
    );
    if (errMsg.includes('Unauthorized')) {
      auditLogService.logAction('PASSKEY_NAME_UPDATE_UNAUTHORIZED', {
        userId: actor.userId,
        username: actor.username,
        credentialIdAttempted: credentialID,
      });
      res.status(403).json({ message: '无权修改此 Passkey。' });
    } else if (errMsg.includes('not found')) {
      res.status(404).json({ message: 'Passkey 未找到。' });
    } else {
      next(error);
    }
  }
};

/**
 * 检查系统是否配置了 Passkey (GET /api/v1/passkey/has-configured)
 * 公开端点，用于登录页面判断是否显示 Passkey 登录选项
 */
export const checkHasPasskeys = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const username = req.query.username as string | undefined;
    const hasPasskeys = await passkeyService.hasPasskeysConfigured(username);
    res.status(200).json({ hasPasskeys });
  } catch (error: unknown) {
    logger.error(error as Error, '[Passkey] 检查 Passkey 配置状态失败');
    next(error);
  }
};
