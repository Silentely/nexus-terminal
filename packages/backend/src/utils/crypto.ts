import crypto from 'crypto';
import bcrypt from 'bcrypt'; // Keep bcrypt import if needed elsewhere
import { SECURITY_CONFIG } from '../config/security.config';

const algorithm = 'aes-256-gcm';
const ivLength = 16; // GCM 推荐的 IV 长度为 12 或 16 字节
const tagLength = 16; // GCM 认证标签长度

/**
 * Internal helper to get and validate the encryption key buffer on demand.
 */
export const getEncryptionKeyBuffer = (): Buffer => {
  const keyEnv = process.env.ENCRYPTION_KEY;
  if (!keyEnv) {
    // This should ideally not happen due to initializeEnvironment in index.ts
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
 * 加密文本 (例如连接密码)
 * @param text - 需要加密的明文
 * @returns Base64 编码的字符串，格式为 "iv:encrypted:tag" (Note: Original code concatenates directly)
 */
export const encrypt = (text: string): string => {
  try {
    const encryptionKey = getEncryptionKeyBuffer(); // Get key on demand
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // 将 iv、密文和认证标签组合并编码 (Original concatenation method)
    return Buffer.concat([iv, encrypted, tag]).toString('base64');
  } catch (error) {
    console.error('加密失败:', error);
    throw new Error('加密过程中发生错误');
  }
};

/**
 * 解密文本
 * @param encryptedText - Base64 编码的加密字符串 (Original concatenated format)
 * @returns 解密后的明文
 */
export const decrypt = (encryptedText: string): string => {
  try {
    const encryptionKey = getEncryptionKeyBuffer(); // Get key on demand
    const data = Buffer.from(encryptedText, 'base64');
    if (data.length < ivLength + tagLength) {
      throw new Error('无效的加密数据格式');
    }

    // 从组合数据中提取 iv、密文和认证标签
    const iv = data.slice(0, ivLength);
    const encrypted = data.slice(ivLength, data.length - tagLength);
    const tag = data.slice(data.length - tagLength);

    const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
    decipher.setAuthTag(tag); // 设置认证标签以供验证

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('解密失败:', error);
    // 在实际应用中，解密失败通常意味着数据被篡改或密钥错误
    // 不应向客户端泄露具体错误细节
    throw new Error('解密过程中发生错误或数据无效');
  }
};

// --- Password Hashing (Keep if needed) ---
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SECURITY_CONFIG.BCRYPT_SALT_ROUNDS);
}
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// --- Secure Random String (Keep if needed) ---
export function generateSecureRandomString(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// --- WebAuthn Base64URL Utilities (Can be removed if not needed elsewhere) ---
export function bufferToBase64url(buffer: ArrayBuffer | Buffer): string {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return buf.toString('base64url');
}
export function base64urlToBuffer(base64urlString: string): Buffer {
  return Buffer.from(base64urlString, 'base64url');
}
