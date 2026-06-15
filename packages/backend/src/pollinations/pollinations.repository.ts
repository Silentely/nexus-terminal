/**
 * Pollinations 配置 Repository 层
 * 处理 Pollinations 配置的数据库操作和加密/解密
 */

import { getDbInstance, runDb, getDb } from '../database/connection';
import { encrypt, decrypt } from '../utils/crypto';
import { logger } from '../utils/logger';
import type { PollinationsSettings, DecryptedSettings } from '../types/pollinations.types';

/**
 * 查询用户的 Pollinations 配置（解密敏感字段）
 */
export const getUserSettings = async (userId: number): Promise<DecryptedSettings | null> => {
  const db = await getDbInstance();
  const row = await getDb<PollinationsSettings>(
    db,
    `SELECT * FROM pollinations_settings WHERE user_id = ?`,
    [userId]
  );

  if (!row) {
    return null;
  }

  try {
    return {
      app_key: decrypt(row.encrypted_app_key),
      user_key: row.encrypted_user_key ? decrypt(row.encrypted_user_key) : null,
      scope: row.scope,
      models: row.models.split(','),
      budget: row.budget,
      expiry: row.expiry,
      enabled: row.enabled === 1,
    };
  } catch (error: unknown) {
    logger.error('[Pollinations Repository] 解密配置失败', { userId, error });
    throw new Error('解密 Pollinations 配置失败');
  }
};

/**
 * 保存或更新用户的 Pollinations 配置（加密敏感字段）
 * 使用 INSERT ... ON CONFLICT 实现 upsert
 */
export const saveSettings = async (
  userId: number,
  settings: Partial<DecryptedSettings>
): Promise<void> => {
  const db = await getDbInstance();

  // 加密敏感字段（仅当提供时）
  const encryptedAppKey = settings.app_key !== undefined ? encrypt(settings.app_key) : undefined;
  const encryptedUserKey =
    settings.user_key !== undefined && settings.user_key !== null
      ? encrypt(settings.user_key)
      : settings.user_key === null
        ? null
        : undefined;

  // 用于标记是否需要清空 user_key（三态：undefined=保留, null=清空, string=更新）
  const shouldClearUserKey = settings.user_key !== undefined && settings.user_key === null;

  await runDb(
    db,
    `
    INSERT INTO pollinations_settings (
      user_id, encrypted_app_key, encrypted_user_key, scope, models, budget, expiry, enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(user_id) DO UPDATE SET
      encrypted_app_key = COALESCE(?, encrypted_app_key),
      encrypted_user_key = CASE WHEN ? THEN NULL WHEN ? IS NOT NULL THEN ? ELSE encrypted_user_key END,
      scope = COALESCE(?, scope),
      models = COALESCE(?, models),
      budget = COALESCE(?, budget),
      expiry = COALESCE(?, expiry),
      enabled = COALESCE(?, enabled),
      updated_at = strftime('%s', 'now')
    `,
    [
      // INSERT 部分
      userId,
      encryptedAppKey ?? '',
      encryptedUserKey ?? null,
      settings.scope ?? 'usage,keys',
      settings.models ? settings.models.join(',') : 'openai,claude,gemini',
      settings.budget ?? 5.0,
      settings.expiry ?? 604800,
      settings.enabled !== undefined ? (settings.enabled ? 1 : 0) : 1,
      // UPDATE 部分
      encryptedAppKey ?? null,
      shouldClearUserKey ? 1 : 0, // 是否清空 user_key
      encryptedUserKey ?? null,
      encryptedUserKey ?? null,
      settings.scope ?? null,
      settings.models ? settings.models.join(',') : null,
      settings.budget ?? null,
      settings.expiry ?? null,
      settings.enabled !== undefined ? (settings.enabled ? 1 : 0) : null,
    ]
  );

  logger.info('[Pollinations Repository] 配置保存成功', { userId });
};

/**
 * 删除用户的 Pollinations 配置
 */
export const deleteSettings = async (userId: number): Promise<void> => {
  const db = await getDbInstance();
  await runDb(db, `DELETE FROM pollinations_settings WHERE user_id = ?`, [userId]);
  logger.info('[Pollinations Repository] 配置删除成功', { userId });
};

/**
 * 检查用户是否启用了 Pollinations（且有有效 User Key）
 */
export const isPollinationsEnabled = async (userId: number): Promise<boolean> => {
  const db = await getDbInstance();
  const row = await getDb<{ enabled: number; encrypted_user_key: string | null }>(
    db,
    `SELECT enabled, encrypted_user_key FROM pollinations_settings WHERE user_id = ?`,
    [userId]
  );

  return row?.enabled === 1 && !!row.encrypted_user_key;
};

/**
 * 更新 User Key（授权成功后调用，加密存储）
 */
export const updateUserKey = async (userId: number, userKey: string): Promise<void> => {
  const db = await getDbInstance();
  const encryptedUserKey = encrypt(userKey);

  await runDb(
    db,
    `
    UPDATE pollinations_settings
    SET encrypted_user_key = ?, updated_at = strftime('%s', 'now')
    WHERE user_id = ?
    `,
    [encryptedUserKey, userId]
  );

  logger.info('[Pollinations Repository] User Key 更新成功', { userId });
};

/**
 * 清除 User Key 并禁用（撤销授权时调用）
 */
export const clearUserKey = async (userId: number): Promise<void> => {
  const db = await getDbInstance();

  await runDb(
    db,
    `
    UPDATE pollinations_settings
    SET encrypted_user_key = NULL, enabled = 0, updated_at = strftime('%s', 'now')
    WHERE user_id = ?
    `,
    [userId]
  );

  logger.info('[Pollinations Repository] User Key 已清除', { userId });
};
