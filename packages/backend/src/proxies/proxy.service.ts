import * as ProxyRepository from './proxy.repository';
import { encrypt, decrypt } from '../utils/crypto';

export interface ProxyData extends ProxyRepository.ProxyData {}

export interface CreateProxyInput {
  name: string;
  type: 'SOCKS5' | 'HTTP';
  host: string;
  port: number;
  username?: string | null;
  auth_method?: 'none' | 'password' | 'key';
  password?: string | null;
  private_key?: string | null;
  passphrase?: string | null;
}

export interface UpdateProxyInput {
  name?: string;
  type?: 'SOCKS5' | 'HTTP';
  host?: string;
  port?: number;
  username?: string | null;
  auth_method?: 'none' | 'password' | 'key';
  password?: string | null;
  private_key?: string | null;
  passphrase?: string | null;
}

/**
 * 获取所有代理
 */
export const getAllProxies = async (): Promise<ProxyData[]> => {
  return ProxyRepository.findAllProxies();
};

/**
 * 根据 ID 获取单个代理
 */
export const getProxyById = async (id: number): Promise<ProxyData | null> => {
  return ProxyRepository.findProxyById(id);
};

/**
 * 创建新代理
 */
export const createProxy = async (input: CreateProxyInput): Promise<ProxyData> => {
  // 1. 验证输入
  if (!input.name || !input.type || !input.host || !input.port) {
    throw new Error('缺少必要的代理信息 (name, type, host, port)。');
  }
  if (input.auth_method === 'password' && !input.password) {
    throw new Error('代理密码认证方式需要提供 password。');
  }
  if (input.auth_method === 'key' && !input.private_key) {
    throw new Error('代理密钥认证方式需要提供 private_key。');
  }

  // 2. 如果提供，则加密凭证
  const encryptedPassword = input.password ? encrypt(input.password) : null;
  const encryptedPrivateKey = input.private_key ? encrypt(input.private_key) : null;
  const encryptedPassphrase = input.passphrase ? encrypt(input.passphrase) : null;

  // 3. 准备仓库数据
  const proxyData: Omit<ProxyData, 'id' | 'created_at' | 'updated_at'> = {
    name: input.name,
    type: input.type,
    host: input.host,
    port: input.port,
    username: input.username || null,
    auth_method: input.auth_method || 'none',
    encrypted_password: encryptedPassword,
    encrypted_private_key: encryptedPrivateKey,
    encrypted_passphrase: encryptedPassphrase,
  };

  // 4. 创建代理记录
  const newProxyId = await ProxyRepository.createProxy(proxyData);

  // 5. 获取并返回新创建的代理
  const newProxy = await getProxyById(newProxyId);
  if (!newProxy) {
    throw new Error('创建代理后无法检索到该代理。');
  }
  return newProxy;
};

/**
 * 更新代理信息
 */
export const updateProxy = async (
  id: number,
  input: UpdateProxyInput
): Promise<ProxyData | null> => {
  // 1. 获取当前代理数据以进行比较（例如，用于认证方法更改逻辑）
  const currentProxy = await ProxyRepository.findProxyById(id);
  if (!currentProxy) {
    return null; // 未找到代理
  }

  // 2. 准备更新数据
  const dataToUpdate: Partial<Omit<ProxyData, 'id' | 'created_at'>> = {};
  let needsCredentialUpdate = false;
  const newAuthMethod = input.auth_method || currentProxy.auth_method;

  // 更新标准字段
  if (input.name !== undefined) dataToUpdate.name = input.name;
  if (input.type !== undefined) dataToUpdate.type = input.type;
  if (input.host !== undefined) dataToUpdate.host = input.host;
  if (input.port !== undefined) dataToUpdate.port = input.port;
  if (input.username !== undefined) dataToUpdate.username = input.username; // 允许清除

  // 处理认证方法更改或凭证更新
  if (input.auth_method && input.auth_method !== currentProxy.auth_method) {
    dataToUpdate.auth_method = input.auth_method;
    needsCredentialUpdate = true;
    // 根据 *新* 认证方法加密新凭证
    if (input.auth_method === 'password') {
      if (input.password === undefined) throw new Error('切换到密码认证时需要提供 password。');
      dataToUpdate.encrypted_password = input.password ? encrypt(input.password) : null;
      dataToUpdate.encrypted_private_key = null; // 清除旧密钥信息
      dataToUpdate.encrypted_passphrase = null;
    } else if (input.auth_method === 'key') {
      if (input.private_key === undefined)
        throw new Error('切换到密钥认证时需要提供 private_key。');
      dataToUpdate.encrypted_private_key = input.private_key ? encrypt(input.private_key) : null;
      dataToUpdate.encrypted_passphrase = input.passphrase ? encrypt(input.passphrase) : null;
      dataToUpdate.encrypted_password = null; // 清除旧密码信息
    } else {
      // '无'
      dataToUpdate.encrypted_password = null;
      dataToUpdate.encrypted_private_key = null;
      dataToUpdate.encrypted_passphrase = null;
    }
  } else {
    // 认证方法未更改，如果为当前方法提供了凭证，则更新凭证
    if (newAuthMethod === 'password' && input.password !== undefined) {
      dataToUpdate.encrypted_password = input.password ? encrypt(input.password) : null;
      needsCredentialUpdate = true;
    } else if (newAuthMethod === 'key') {
      if (input.private_key !== undefined) {
        dataToUpdate.encrypted_private_key = input.private_key ? encrypt(input.private_key) : null;
        dataToUpdate.encrypted_passphrase = input.passphrase ? encrypt(input.passphrase) : null; // 一起更新密码短语
        needsCredentialUpdate = true;
      } else if (input.passphrase !== undefined) {
        // 仅更新密码短语
        dataToUpdate.encrypted_passphrase = input.passphrase ? encrypt(input.passphrase) : null;
        needsCredentialUpdate = true;
      }
    }
  }

  // 3. 如果有更改，则更新代理记录
  const hasChanges = Object.keys(dataToUpdate).length > 0;
  if (hasChanges) {
    const updated = await ProxyRepository.updateProxy(id, dataToUpdate);
    if (!updated) {
      throw new Error('更新代理记录失败。');
    }
  }

  // 4. 获取并返回更新后的代理
  return getProxyById(id);
};

/**
 * 删除代理
 */
export const deleteProxy = async (id: number): Promise<boolean> => {
  return ProxyRepository.deleteProxy(id);
};
