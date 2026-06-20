/**
 * Crypto 工具模块单元测试
 * 测试加密/解密、密钥轮换、密码哈希等功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// 测试用的固定密钥（32 字节 = 64 hex 字符）
const TEST_KEY_1 = 'a'.repeat(64);
const TEST_KEY_2 = 'b'.repeat(64);
const TEST_KEY_INVALID_LENGTH = 'a'.repeat(32); // 16 字节，无效

describe('Crypto Module', () => {
  // 保存原始环境变量
  const originalEnv = process.env;

  beforeEach(() => {
    // 重置模块状态 - 需要重新导入模块
    vi.resetModules();
    process.env = { ...originalEnv, ENCRYPTION_KEY: TEST_KEY_1 };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('getEncryptionKeyBuffer', () => {
    it('应成功获取有效的加密密钥 Buffer', async () => {
      const { getEncryptionKeyBuffer } = await import('./crypto');
      const keyBuffer = getEncryptionKeyBuffer();

      expect(keyBuffer).toBeInstanceOf(Buffer);
      expect(keyBuffer.length).toBe(32);
    });

    it('ENCRYPTION_KEY 未设置时应抛出错误', async () => {
      delete process.env.ENCRYPTION_KEY;
      const { getEncryptionKeyBuffer } = await import('./crypto');

      expect(() => getEncryptionKeyBuffer()).toThrow('ENCRYPTION_KEY is not set.');
    });

    it('ENCRYPTION_KEY 长度无效时应抛出错误', async () => {
      process.env.ENCRYPTION_KEY = TEST_KEY_INVALID_LENGTH;
      const { getEncryptionKeyBuffer } = await import('./crypto');

      expect(() => getEncryptionKeyBuffer()).toThrow('Failed to decode ENCRYPTION_KEY.');
    });

    it('ENCRYPTION_KEY 非法 hex 字符时应抛出错误', async () => {
      process.env.ENCRYPTION_KEY = 'not-valid-hex-string!!!';
      const { getEncryptionKeyBuffer } = await import('./crypto');

      // Buffer.from 对非法 hex 会静默处理，但长度会不对
      expect(() => getEncryptionKeyBuffer()).toThrow();
    });
  });

  describe('encrypt / decrypt 基础功能', () => {
    it('应成功加密和解密文本', async () => {
      const { encrypt, decrypt } = await import('./crypto');
      const plainText = '这是一段测试文本 Hello World 123!@#';

      const encrypted = encrypt(plainText);
      const decrypted = decrypt(encrypted);

      expect(encrypted).not.toBe(plainText);
      expect(decrypted).toBe(plainText);
    });

    it('应成功处理空字符串', async () => {
      const { encrypt, decrypt } = await import('./crypto');
      const plainText = '';

      const encrypted = encrypt(plainText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('应成功处理长文本', async () => {
      const { encrypt, decrypt } = await import('./crypto');
      const plainText = 'A'.repeat(10000);

      const encrypted = encrypt(plainText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('应成功处理 Unicode 字符', async () => {
      const { encrypt, decrypt } = await import('./crypto');
      const plainText = '中文测试 日本語テスト 한국어 테스트 🎉🚀💻';

      const encrypted = encrypt(plainText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('相同明文每次加密结果应不同（随机 IV）', async () => {
      const { encrypt } = await import('./crypto');
      const plainText = 'test message';

      const encrypted1 = encrypt(plainText);
      const encrypted2 = encrypt(plainText);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('无效的加密数据应抛出错误', async () => {
      const { decrypt } = await import('./crypto');
      const invalidData = 'not-valid-base64-encrypted-data!!!';

      expect(() => decrypt(invalidData)).toThrow('解密过程中发生错误或数据无效');
    });

    it('被篡改的加密数据应抛出错误', async () => {
      const { encrypt, decrypt } = await import('./crypto');
      const plainText = 'test message';

      const encrypted = encrypt(plainText);
      // 篡改加密数据的一部分
      const tamperedData = `${encrypted.slice(0, -5)}xxxxx`;

      expect(() => decrypt(tamperedData)).toThrow();
    });
  });

  describe('密钥轮换系统', () => {
    it('initializeKeyRotation 应初始化密钥存储', async () => {
      const { initializeKeyRotation, getKeyRotationStatus } = await import('./crypto');

      initializeKeyRotation();
      const status = getKeyRotationStatus();

      expect(status.activeKeyId).toBe(1);
      expect(status.totalKeys).toBe(1);
      expect(status.keys).toHaveLength(1);
      expect(status.keys[0].isActive).toBe(true);
    });

    it('initializeKeyRotation 重复调用应幂等', async () => {
      const { initializeKeyRotation, getKeyRotationStatus } = await import('./crypto');

      initializeKeyRotation();
      initializeKeyRotation();
      initializeKeyRotation();

      const status = getKeyRotationStatus();
      expect(status.totalKeys).toBe(1);
    });

    it('rotateEncryptionKey 应添加新密钥并设为活跃', async () => {
      const { initializeKeyRotation, rotateEncryptionKey, getKeyRotationStatus } =
        await import('./crypto');

      initializeKeyRotation();
      const newKeyId = rotateEncryptionKey(TEST_KEY_2);

      expect(newKeyId).toBe(2);

      const status = getKeyRotationStatus();
      expect(status.activeKeyId).toBe(2);
      expect(status.totalKeys).toBe(2);
      expect(status.keys.find((k) => k.keyId === 1)?.isActive).toBe(false);
      expect(status.keys.find((k) => k.keyId === 2)?.isActive).toBe(true);
    });

    it('rotateEncryptionKey 无效密钥长度应抛出错误', async () => {
      const { initializeKeyRotation, rotateEncryptionKey } = await import('./crypto');

      initializeKeyRotation();

      expect(() => rotateEncryptionKey(TEST_KEY_INVALID_LENGTH)).toThrow(
        '新密钥长度必须是 32 字节',
      );
    });

    it('密钥轮换后应能解密旧密钥加密的数据', async () => {
      const { encrypt, decrypt, initializeKeyRotation, rotateEncryptionKey } =
        await import('./crypto');

      initializeKeyRotation();
      const plainText = 'secret data';

      // 使用旧密钥加密
      const encryptedWithOldKey = encrypt(plainText);

      // 轮换到新密钥
      rotateEncryptionKey(TEST_KEY_2);

      // 应仍能解密旧数据
      const decrypted = decrypt(encryptedWithOldKey);
      expect(decrypted).toBe(plainText);
    });

    it('密钥轮换后新加密应使用新密钥', async () => {
      const { encrypt, decrypt, initializeKeyRotation, rotateEncryptionKey } =
        await import('./crypto');

      initializeKeyRotation();

      // 轮换到新密钥
      rotateEncryptionKey(TEST_KEY_2);

      const plainText = 'new secret';
      const encrypted = encrypt(plainText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('reEncrypt 应使用当前密钥重新加密', async () => {
      const { encrypt, decrypt, reEncrypt, initializeKeyRotation, rotateEncryptionKey } =
        await import('./crypto');

      initializeKeyRotation();
      const plainText = 'data to migrate';

      // 使用旧密钥加密
      const encryptedWithOldKey = encrypt(plainText);

      // 轮换到新密钥
      rotateEncryptionKey(TEST_KEY_2);

      // 重新加密
      const reEncrypted = reEncrypt(encryptedWithOldKey);

      // 重新加密后的数据应与原加密数据不同
      expect(reEncrypted).not.toBe(encryptedWithOldKey);

      // 但解密结果相同
      expect(decrypt(reEncrypted)).toBe(plainText);
    });

    it('多次密钥轮换应正确工作', async () => {
      const { encrypt, decrypt, initializeKeyRotation, rotateEncryptionKey, getKeyRotationStatus } =
        await import('./crypto');

      initializeKeyRotation();

      // 存储每个版本加密的数据
      const encrypted1 = encrypt('data1');

      rotateEncryptionKey(TEST_KEY_2);
      const encrypted2 = encrypt('data2');

      const key3 = 'c'.repeat(64);
      rotateEncryptionKey(key3);
      const encrypted3 = encrypt('data3');

      // 验证状态
      const status = getKeyRotationStatus();
      expect(status.activeKeyId).toBe(3);
      expect(status.totalKeys).toBe(3);

      // 所有版本的数据都应能解密
      expect(decrypt(encrypted1)).toBe('data1');
      expect(decrypt(encrypted2)).toBe('data2');
      expect(decrypt(encrypted3)).toBe('data3');
    });
  });

  describe('新旧格式兼容（Legacy Format）', () => {
    it('应能解密旧格式数据', async () => {
      // 手动创建旧格式加密数据（无版本头）
      const keyBuffer = Buffer.from(TEST_KEY_1, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
      const plainText = 'legacy data';
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      // 旧格式：[iv][encrypted][tag]
      const legacyEncrypted = Buffer.concat([iv, encrypted, tag]).toString('base64');

      const { decrypt } = await import('./crypto');
      const decrypted = decrypt(legacyEncrypted);

      expect(decrypted).toBe(plainText);
    });

    it('新格式应包含版本头', async () => {
      const { encrypt } = await import('./crypto');

      const encrypted = encrypt('test');
      const buffer = Buffer.from(encrypted, 'base64');

      // 新格式前 4 字节是版本号
      const version = buffer.readUInt32BE(0);
      expect(version).toBeGreaterThanOrEqual(1);
      expect(version).toBeLessThanOrEqual(1000);
    });
  });

  describe('hashPassword / comparePassword', () => {
    it('应成功哈希密码', async () => {
      const { hashPassword } = await import('./crypto');
      const password = 'MySecurePassword123!';

      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2')).toBe(true); // bcrypt hash 格式
    });

    it('相同密码每次哈希结果应不同（随机盐）', async () => {
      const { hashPassword } = await import('./crypto');
      const password = 'TestPassword';

      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });

    it('comparePassword 应正确验证匹配的密码', async () => {
      const { hashPassword, comparePassword } = await import('./crypto');
      const password = 'CorrectPassword123';

      const hash = await hashPassword(password);
      const isMatch = await comparePassword(password, hash);

      expect(isMatch).toBe(true);
    });

    it('comparePassword 应正确拒绝不匹配的密码', async () => {
      const { hashPassword, comparePassword } = await import('./crypto');
      const password = 'CorrectPassword123';
      const wrongPassword = 'WrongPassword456';

      const hash = await hashPassword(password);
      const isMatch = await comparePassword(wrongPassword, hash);

      expect(isMatch).toBe(false);
    });

    it('应处理空密码', async () => {
      const { hashPassword, comparePassword } = await import('./crypto');
      const password = '';

      const hash = await hashPassword(password);
      const isMatch = await comparePassword(password, hash);

      expect(isMatch).toBe(true);
    });

    it('应处理 Unicode 密码', async () => {
      const { hashPassword, comparePassword } = await import('./crypto');
      const password = '密码テスト🔐';

      const hash = await hashPassword(password);
      const isMatch = await comparePassword(password, hash);

      expect(isMatch).toBe(true);
    });
  });

  describe('generateSecureRandomString', () => {
    it('应生成指定长度的随机字符串', async () => {
      const { generateSecureRandomString } = await import('./crypto');

      const str32 = generateSecureRandomString(32);
      const str16 = generateSecureRandomString(16);

      // 返回的是 hex 编码，长度是字节数的 2 倍
      expect(str32.length).toBe(64);
      expect(str16.length).toBe(32);
    });

    it('默认长度应为 32 字节', async () => {
      const { generateSecureRandomString } = await import('./crypto');

      const str = generateSecureRandomString();

      expect(str.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it('每次生成的字符串应不同', async () => {
      const { generateSecureRandomString } = await import('./crypto');

      const str1 = generateSecureRandomString();
      const str2 = generateSecureRandomString();

      expect(str1).not.toBe(str2);
    });

    it('应只包含有效的 hex 字符', async () => {
      const { generateSecureRandomString } = await import('./crypto');

      const str = generateSecureRandomString(64);

      expect(str).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('bufferToBase64url / base64urlToBuffer', () => {
    it('应正确转换 Buffer 到 base64url', async () => {
      const { bufferToBase64url } = await import('./crypto');
      const buffer = Buffer.from('Hello World');

      const base64url = bufferToBase64url(buffer);

      expect(base64url).toBe('SGVsbG8gV29ybGQ');
      // 不应包含标准 base64 的 + / = 字符
      expect(base64url).not.toMatch(/[+/=]/);
    });

    it('应正确转换 ArrayBuffer 到 base64url', async () => {
      const { bufferToBase64url } = await import('./crypto');
      const arrayBuffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;

      const base64url = bufferToBase64url(arrayBuffer);

      expect(base64url).toBe('SGVsbG8');
    });

    it('应正确转换 base64url 到 Buffer', async () => {
      const { base64urlToBuffer } = await import('./crypto');
      const base64url = 'SGVsbG8gV29ybGQ';

      const buffer = base64urlToBuffer(base64url);

      expect(buffer.toString()).toBe('Hello World');
    });

    it('往返转换应保持数据一致', async () => {
      const { bufferToBase64url, base64urlToBuffer } = await import('./crypto');
      const original = Buffer.from('Test Data 123!@#$%^&*()');

      const base64url = bufferToBase64url(original);
      const restored = base64urlToBuffer(base64url);

      expect(restored.equals(original)).toBe(true);
    });

    it('应正确处理包含特殊字符的数据', async () => {
      const { bufferToBase64url, base64urlToBuffer } = await import('./crypto');
      // 这些字节在标准 base64 中会产生 + 和 /
      const buffer = Buffer.from([0xfb, 0xff, 0xfe]);

      const base64url = bufferToBase64url(buffer);
      const restored = base64urlToBuffer(base64url);

      expect(base64url).not.toContain('+');
      expect(base64url).not.toContain('/');
      expect(restored.equals(buffer)).toBe(true);
    });

    it('应正确处理空 Buffer', async () => {
      const { bufferToBase64url, base64urlToBuffer } = await import('./crypto');
      const empty = Buffer.alloc(0);

      const base64url = bufferToBase64url(empty);
      const restored = base64urlToBuffer(base64url);

      expect(base64url).toBe('');
      expect(restored.length).toBe(0);
    });
  });

  describe('错误处理', () => {
    it('解密未知版本密钥应抛出错误', async () => {
      const { initializeKeyRotation, decrypt } = await import('./crypto');

      initializeKeyRotation();

      // 手动构造一个使用不存在版本号的加密数据
      const fakeVersion = Buffer.alloc(4);
      fakeVersion.writeUInt32BE(999, 0); // 版本 999 不存在
      const fakeIv = crypto.randomBytes(16);
      const fakeEncrypted = Buffer.from('fake');
      const fakeTag = crypto.randomBytes(16);

      const fakeData = Buffer.concat([fakeVersion, fakeIv, fakeEncrypted, fakeTag]).toString(
        'base64',
      );

      expect(() => decrypt(fakeData)).toThrow();
    });
  });
});
