import * as SshKeyRepository from './ssh-keys.repository';
import { encrypt, decrypt } from '../utils/crypto';
import { SshKeyDbRow, CreateSshKeyData, UpdateSshKeyData } from './ssh-keys.repository';

// 定义 Service 层返回给 Controller 的基本密钥信息 (不含加密内容)
export interface SshKeyBasicInfo {
  id: number;
  name: string;
}

// 定义 Service 层创建密钥时的输入类型
export interface CreateSshKeyInput {
  name: string;
  private_key: string; // 明文私钥
  passphrase?: string; // 明文密码短语 (可选)
}

// 定义 Service 层更新密钥时的输入类型 (名称必选，凭证可选)
export interface UpdateSshKeyInput {
  name?: string; // 名称可选，但通常会提供
  private_key?: string; // 明文私钥 (可选，表示要更新)
  passphrase?: string; // 明文密码短语 (可选，如果提供了私钥，则此项也可能需要更新)
}

// 定义包含解密后凭证的密钥详情
export interface DecryptedSshKeyDetails extends SshKeyBasicInfo {
  privateKey: string; // 解密后的私钥
  passphrase?: string; // 解密后的密码短语
}

/**
 * 创建新的 SSH 密钥
 * @param input 包含名称和明文凭证的对象
 * @returns Promise<SshKeyBasicInfo> 新创建密钥的基本信息
 */
export const createSshKey = async (input: CreateSshKeyInput): Promise<SshKeyBasicInfo> => {
  // 1. 验证输入
  if (!input.name || !input.private_key) {
    throw new Error('必须提供密钥名称和私钥内容。');
  }
  // 可选：添加更严格的私钥格式验证

  // 2. 加密凭证
  const encrypted_private_key = encrypt(input.private_key);
  const encrypted_passphrase = input.passphrase ? encrypt(input.passphrase) : null;

  // 3. 准备仓库数据
  const dataToSave: CreateSshKeyData = {
    name: input.name,
    encrypted_private_key,
    encrypted_passphrase,
  };

  // 4. 调用仓库创建记录
  try {
    const newId = await SshKeyRepository.createSshKey(dataToSave);
    return { id: newId, name: input.name };
  } catch (error: any) {
    // 处理可能的 UNIQUE constraint 错误
    if (error.message && error.message.includes('UNIQUE constraint failed: ssh_keys.name')) {
      throw new Error(`SSH 密钥名称 "${input.name}" 已存在。`);
    }
    throw error; // 重新抛出其他错误
  }
};

/**
 * 获取所有 SSH 密钥的基本信息 (ID 和 Name)
 * @returns Promise<SshKeyBasicInfo[]> 密钥列表
 */
export const getAllSshKeyNames = async (): Promise<SshKeyBasicInfo[]> => {
  return SshKeyRepository.findAllSshKeyNames();
};

/**
 * 根据 ID 获取 SSH 密钥的完整数据库行 (包含加密凭证)
 * 供内部服务使用，例如需要解密的场景
 * @param id 密钥 ID
 * @returns Promise<SshKeyDbRow | null> 密钥数据库行或 null
 */
export const getSshKeyDbRowById = async (id: number): Promise<SshKeyDbRow | null> => {
  return SshKeyRepository.findSshKeyById(id);
};

/**
 * 根据 ID 获取解密后的 SSH 密钥详情
 * @param id 密钥 ID
 * @returns Promise<DecryptedSshKeyDetails | null> 解密后的密钥详情或 null
 */
export const getDecryptedSshKeyById = async (
  id: number
): Promise<DecryptedSshKeyDetails | null> => {
  const dbRow = await SshKeyRepository.findSshKeyById(id);
  if (!dbRow) {
    return null;
  }

  try {
    const privateKey = decrypt(dbRow.encrypted_private_key);
    const passphrase = dbRow.encrypted_passphrase ? decrypt(dbRow.encrypted_passphrase) : undefined;
    return {
      id: dbRow.id,
      name: dbRow.name,
      privateKey,
      passphrase,
    };
  } catch (error: any) {
    console.error(`Service: 解密 SSH 密钥 ${id} 失败:`, error);
    // 根据策略决定是抛出错误还是返回 null/部分信息
    throw new Error(`解密 SSH 密钥 ${id} 失败。`);
  }
};

/**
 * 更新 SSH 密钥
 * @param id 要更新的密钥 ID
 * @param input 包含要更新字段的对象 (明文凭证)
 * @returns Promise<SshKeyBasicInfo | null> 更新后的密钥基本信息或 null (如果未找到)
 */
export const updateSshKey = async (
  id: number,
  input: UpdateSshKeyInput
): Promise<SshKeyBasicInfo | null> => {
  // 1. 检查密钥是否存在
  const existingKey = await SshKeyRepository.findSshKeyById(id);
  if (!existingKey) {
    return null; // 未找到
  }

  // 2. 准备要更新的数据
  const dataToUpdate: UpdateSshKeyData = {};
  let finalName = existingKey.name; // 保留现有名称，除非输入中提供了新名称

  if (input.name !== undefined) {
    if (!input.name) {
      throw new Error('密钥名称不能为空。');
    }
    dataToUpdate.name = input.name;
    finalName = input.name; // 更新最终名称
  }

  // 只有当提供了新的私钥时，才更新私钥和密码短语
  if (input.private_key !== undefined) {
    if (!input.private_key) {
      throw new Error('私钥内容不能为空。');
    }
    dataToUpdate.encrypted_private_key = encrypt(input.private_key);
    // 如果更新了私钥，则密码短语也需要更新（即使是设为 null）
    dataToUpdate.encrypted_passphrase = input.passphrase ? encrypt(input.passphrase) : null;
  } else if (input.passphrase !== undefined && existingKey.encrypted_private_key) {
    // 如果只提供了密码短语，且当前存在私钥，则只更新密码短语
    dataToUpdate.encrypted_passphrase = input.passphrase ? encrypt(input.passphrase) : null;
  }

  // 3. 如果有数据需要更新，则调用仓库
  if (Object.keys(dataToUpdate).length > 0) {
    try {
      const updated = await SshKeyRepository.updateSshKey(id, dataToUpdate);
      if (!updated) {
        // 理论上不应发生，因为我们已经检查过存在性
        throw new Error('更新 SSH 密钥记录失败。');
      }
    } catch (error: any) {
      // 处理可能的 UNIQUE constraint 错误
      if (error.message && error.message.includes('UNIQUE constraint failed: ssh_keys.name')) {
        throw new Error(`SSH 密钥名称 "${input.name}" 已存在。`);
      }
      throw error; // 重新抛出其他错误
    }
  }

  // 4. 返回更新后的基本信息
  return { id, name: finalName };
};

/**
 * 删除 SSH 密钥
 * @param id 要删除的密钥 ID
 * @returns Promise<boolean> 是否删除成功
 */
export const deleteSshKey = async (id: number): Promise<boolean> => {
  // 注意：删除密钥前，相关的 connections 表中的 ssh_key_id 会被设为 NULL (ON DELETE SET NULL)
  return SshKeyRepository.deleteSshKey(id);
};
/**
 * 获取所有解密后的 SSH 密钥详情
 * @returns Promise<DecryptedSshKeyDetails[]> 解密后的密钥详情列表
 */
export const getAllDecryptedSshKeys = async (): Promise<DecryptedSshKeyDetails[]> => {
  const dbRows = await SshKeyRepository.findAllSshKeys();
  const decryptedKeys: DecryptedSshKeyDetails[] = [];

  for (const dbRow of dbRows) {
    try {
      const privateKey = decrypt(dbRow.encrypted_private_key);
      const passphrase = dbRow.encrypted_passphrase
        ? decrypt(dbRow.encrypted_passphrase)
        : undefined;
      decryptedKeys.push({
        id: dbRow.id,
        name: dbRow.name,
        privateKey,
        passphrase,
      });
    } catch (error: any) {
      console.error(`Service: 解密 SSH 密钥 ${dbRow.id} 失败:`, error);
      // 继续处理其他密钥，不因单个密钥解密失败而中断整个过程
      // 可以选择记录错误或通知管理员，但这里我们只记录日志
    }
  }

  return decryptedKeys;
};
