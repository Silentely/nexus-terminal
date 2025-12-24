import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { SECURITY_CONFIG } from '../config/security.config';

const algorithm = 'aes-256-gcm';
const ivLength = 16;
const tagLength = 16;
const keyVersionLength = 4; // 4 bytes for key version ID (UInt32BE)

/**
 * 密钥版本接口
 */
interface KeyVersion {
  keyId: number;
  key: Buffer;
  createdAt: Date;
  isActive: boolean;
}

/**
 * 密钥存储 - 支持多版本密钥
 * Key: keyId, Value: KeyVersion
 */
const keyStore: Map<number, KeyVersion> = new Map();
let activeKeyId: number = 1;
let isInitialized = false;

/**
 * 从环境变量获取并验证加密密钥 Buffer
 */
export const getEncryptionKeyBuffer = (): Buffer => {
  const keyEnv = process.env.ENCRYPTION_KEY;
  if (!keyEnv) {
    console.error('错误：ENCRYPTION_KEY 环境变量未设置！');
    throw new Error('ENCRYPTION_KEY is not set.');
  }
  try {
    const keyBuffer = Buffer.from(keyEnv, 'hex');
    if (keyBuffer.length !== 32) {
      console.error(`错误：加密密钥长度必须是 32 字节，当前长度为 ${keyBuffer.length}。`);
      throw new Error('Invalid ENCRYPTION_KEY length.');
    }
    return keyBuffer;
  } catch (error) {
    console.error('错误：无法将 ENCRYPTION_KEY 从 hex 解码为 Buffer:', error);
    throw new Error('Failed to decode ENCRYPTION_KEY.');
  }
};

/**
 * 初始化密钥轮换系统
 * 将当前环境变量中的密钥作为版本 1 注册
 */
export const initializeKeyRotation = (): void => {
  if (isInitialized) return;

  const currentKey = getEncryptionKeyBuffer();
  keyStore.set(1, {
    keyId: 1,
    key: currentKey,
    createdAt: new Date(),
    isActive: true,
  });
  activeKeyId = 1;
  isInitialized = true;
};

/**
 * 获取当前活跃密钥
 */
const getActiveKey = (): KeyVersion => {
  if (!isInitialized) {
    initializeKeyRotation();
  }
  const key = keyStore.get(activeKeyId);
  if (!key) {
    throw new Error(`未找到活跃密钥版本: ${activeKeyId}`);
  }
  return key;
};

/**
 * 根据版本 ID 获取密钥
 */
const getKeyByVersion = (keyId: number): KeyVersion | undefined => {
  if (!isInitialized) {
    initializeKeyRotation();
  }
  return keyStore.get(keyId);
};

/**
 * 检测加密数据是否为旧格式（无版本头）
 * 旧格式：[iv(16)][encrypted][tag(16)] - 直接 base64 编码
 * 新格式：[version(4)][iv(16)][encrypted][tag(16)] - 带版本头
 */
const isLegacyFormat = (data: Buffer): boolean => {
  // 旧格式最小长度 = iv(16) + tag(16) = 32 字节
  // 新格式最小长度 = version(4) + iv(16) + tag(16) = 36 字节
  // 通过检查前 4 字节是否为合理的版本号来判断
  // 版本号范围 1-1000 被认为是有效的新格式
  if (data.length < ivLength + tagLength) {
    return true; // 数据太短，可能是损坏的旧格式
  }

  if (data.length >= keyVersionLength + ivLength + tagLength) {
    const possibleVersion = data.readUInt32BE(0);
    // 合理版本号范围：1-1000
    if (possibleVersion >= 1 && possibleVersion <= 1000) {
      return false; // 新格式
    }
  }

  return true; // 默认视为旧格式
};

/**
 * 加密文本（支持密钥版本）
 * 新格式：[keyVersion(4 bytes)][iv(16 bytes)][encrypted][tag(16 bytes)]
 * @param text - 需要加密的明文
 * @returns Base64 编码的加密字符串
 */
export const encrypt = (text: string): string => {
  try {
    const keyVersion = getActiveKey();
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, keyVersion.key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // 将密钥版本 ID 编码到密文头部
    const keyIdBuffer = Buffer.alloc(keyVersionLength);
    keyIdBuffer.writeUInt32BE(keyVersion.keyId, 0);

    // 组合格式：[keyVersion][iv][encrypted][tag]
    return Buffer.concat([keyIdBuffer, iv, encrypted, tag]).toString('base64');
  } catch (error) {
    console.error('加密失败:', error);
    throw new Error('加密过程中发生错误');
  }
};

/**
 * 解密文本（支持新旧格式兼容）
 * @param encryptedText - Base64 编码的加密字符串
 * @returns 解密后的明文
 */
export const decrypt = (encryptedText: string): string => {
  try {
    const data = Buffer.from(encryptedText, 'base64');

    let iv: Buffer;
    let encrypted: Buffer;
    let tag: Buffer;
    let decryptionKey: Buffer;

    if (isLegacyFormat(data)) {
      // 旧格式：直接使用环境变量中的密钥
      if (data.length < ivLength + tagLength) {
        throw new Error('无效的加密数据格式');
      }
      iv = data.subarray(0, ivLength);
      encrypted = data.subarray(ivLength, data.length - tagLength);
      tag = data.subarray(data.length - tagLength);
      decryptionKey = getEncryptionKeyBuffer();
    } else {
      // 新格式：解析版本号并获取对应密钥
      const keyId = data.readUInt32BE(0);
      const keyVersion = getKeyByVersion(keyId);
      if (!keyVersion) {
        throw new Error(`未找到密钥版本: ${keyId}`);
      }

      iv = data.subarray(keyVersionLength, keyVersionLength + ivLength);
      encrypted = data.subarray(keyVersionLength + ivLength, data.length - tagLength);
      tag = data.subarray(data.length - tagLength);
      decryptionKey = keyVersion.key;
    }

    const decipher = crypto.createDecipheriv(algorithm, decryptionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('解密失败:', error);
    throw new Error('解密过程中发生错误或数据无效');
  }
};

/**
 * 密钥轮换 - 添加新密钥并设为活跃
 * 注意：此函数应由管理 API 调用，新密钥需要持久化到安全存储
 * @param newKeyHex - 新密钥的 hex 编码字符串
 * @returns 新密钥的版本 ID
 */
export const rotateEncryptionKey = (newKeyHex: string): number => {
  const newKeyBuffer = Buffer.from(newKeyHex, 'hex');
  if (newKeyBuffer.length !== 32) {
    throw new Error('新密钥长度必须是 32 字节');
  }

  const newKeyId = activeKeyId + 1;

  // 将旧密钥标记为非活跃
  const oldKey = keyStore.get(activeKeyId);
  if (oldKey) {
    oldKey.isActive = false;
  }

  // 注册新密钥
  keyStore.set(newKeyId, {
    keyId: newKeyId,
    key: newKeyBuffer,
    createdAt: new Date(),
    isActive: true,
  });

  activeKeyId = newKeyId;
  return newKeyId;
};

/**
 * 重新加密数据（用于密钥轮换后迁移旧数据）
 * @param encryptedText - 旧的加密文本
 * @returns 使用当前活跃密钥重新加密的文本
 */
export const reEncrypt = (encryptedText: string): string => {
  const plainText = decrypt(encryptedText);
  return encrypt(plainText);
};

/**
 * 获取当前密钥状态信息（用于管理界面）
 */
export const getKeyRotationStatus = (): {
  activeKeyId: number;
  totalKeys: number;
  keys: Array<{ keyId: number; createdAt: Date; isActive: boolean }>;
} => {
  if (!isInitialized) {
    initializeKeyRotation();
  }

  const keys = Array.from(keyStore.values()).map((k) => ({
    keyId: k.keyId,
    createdAt: k.createdAt,
    isActive: k.isActive,
  }));

  return {
    activeKeyId,
    totalKeys: keyStore.size,
    keys,
  };
};

// --- Password Hashing ---
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SECURITY_CONFIG.BCRYPT_SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// --- Secure Random String ---
export function generateSecureRandomString(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// --- WebAuthn Base64URL Utilities ---
export function bufferToBase64url(buffer: ArrayBuffer | Buffer): string {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return buf.toString('base64url');
}

export function base64urlToBuffer(base64urlString: string): Buffer {
  return Buffer.from(base64urlString, 'base64url');
}
