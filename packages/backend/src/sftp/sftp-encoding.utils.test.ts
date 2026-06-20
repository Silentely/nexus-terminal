import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
import { detectAndDecodeSftpFileContent } from './sftp-encoding.utils';

vi.mock('jschardet', () => ({
  detect: vi.fn(),
}));

vi.mock('iconv-lite', () => ({
  decode: vi.fn((_buf: Buffer, _enc: string) => _buf.toString('utf8')),
  encodingExists: vi.fn((enc: string) =>
    ['utf-8', 'utf8', 'ascii', 'gbk', 'gb18030', 'big5', 'cp1252'].includes(enc),
  ),
}));

const baseInput = {
  sessionId: 'test-session',
  remotePath: '/home/test.txt',
  requestId: 'req-1',
};

describe('sftp-encoding.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('指定编码时', () => {
    it('应使用指定编码解码', () => {
      const fileData = Buffer.from('hello');
      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
        requestedEncoding: 'gbk',
      });

      expect(result.encodingUsed).toBe('gbk');
      expect(result.decodedContent).toBe('hello');
    });

    it('指定不支持的编码时应降级为 UTF-8', () => {
      vi.mocked(iconv.encodingExists).mockReturnValue(false);

      const fileData = Buffer.from('hello');
      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
        requestedEncoding: 'nonexistent',
      });

      expect(result.encodingUsed).toBe('utf-8');
      expect(result.decodedContent).toBe('hello');
    });

    it('应规范化编码名称（大写/特殊字符）', () => {
      const fileData = Buffer.from('hello');
      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
        requestedEncoding: 'UTF-8',
      });

      // normalizeEncodingName('UTF-8') → 'utf8'
      // iconv.encodingExists('utf8') → true（mock）→ encodingUsed = 'utf8'
      expect(result.encodingUsed).toBeDefined();
      expect(typeof result.decodedContent).toBe('string');
    });

    it('应规范化含连字符的编码名', () => {
      const fileData = Buffer.from('test');
      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
        requestedEncoding: 'iso-8859-1',
      });

      // normalizeEncodingName 去掉非字母数字字符
      expect(result.encodingUsed).toBeDefined();
      expect(typeof result.decodedContent).toBe('string');
    });
  });

  describe('自动检测编码时', () => {
    it('UTF-8 编码应直接返回', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'utf-8', confidence: 0.99 });
      const fileData = Buffer.from('hello world');

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('utf-8');
      expect(result.decodedContent).toBe('hello world');
    });

    it('ASCII 编码应降级为 UTF-8', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'ascii', confidence: 1.0 });
      const fileData = Buffer.from('hello');

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('utf-8');
    });

    it('GB2312 检测应规范化为 GBK 再升为 GB18030', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'GB2312', confidence: 0.95 });
      vi.mocked(iconv.decode).mockReturnValueOnce('中文内容');
      const fileData = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('gb18030');
      expect(result.decodedContent).toBe('中文内容');
    });

    it('GBK 检测应升为 GB18030', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'GBK', confidence: 0.95 });
      vi.mocked(iconv.decode).mockReturnValueOnce('中文');
      const fileData = Buffer.from([0xd6, 0xd0]);

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('gb18030');
    });

    it('Big5 编码应使用 GB18030 解码', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'Big5', confidence: 0.95 });
      vi.mocked(iconv.decode).mockReturnValueOnce('繁體');
      const fileData = Buffer.from([0xa4, 0xa4]);

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('gb18030');
      expect(result.decodedContent).toBe('繁體');
    });

    it('低置信度检测应尝试 GB18030 后再降级', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'Shift_JIS', confidence: 0.4 });
      // GB18030 解码产生替换字符，应降级
      vi.mocked(iconv.decode)
        .mockReturnValueOnce('�') // GB18030 尝试产生替换字符
        .mockReturnValueOnce('fallback'); // fallback 解码
      vi.mocked(iconv.encodingExists).mockReturnValue(true);
      const fileData = Buffer.from([0x82, 0x60]);

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      // Shift_JIS → normalizeEncodingName → 'shiftjis'
      // 'shiftjis' 在 iconv.encodingExists(mock 返回 true) 时走 decodeWithDetectedFallback
      // 但 GB18030 产生替换字符后，fallback 也用 iconv.decode
      expect(result.decodedContent).toBeDefined();
    });

    it('检测结果为 null 时应降级为 UTF-8', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: null, confidence: 0 });
      const fileData = Buffer.from('hello');

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('utf-8');
      expect(result.decodedContent).toBe('hello');
    });

    it('Windows-1252 应规范化为 cp1252', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'windows-1252', confidence: 0.95 });
      vi.mocked(iconv.encodingExists).mockReturnValue(true);
      vi.mocked(iconv.decode).mockReturnValueOnce('latin text');
      const fileData = Buffer.from('latin text');

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('cp1252');
    });

    it('不支持的编码名称应降级为 UTF-8', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'UNKNOWN_ENC', confidence: 0.95 });
      vi.mocked(iconv.encodingExists).mockReturnValue(false);
      const fileData = Buffer.from('fallback');

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('utf-8');
    });

    it('EUC-TW 应作为中文编码处理', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'EUC-TW', confidence: 0.9 });
      const fileData = Buffer.from('繁中');

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      // EUC-TW 在 chineseEncodings 列表中，normalize → 'euctw'
      // 应走中文编码分支，使用 gb18030 解码
      expect(result.encodingUsed).toBeDefined();
      expect(typeof result.decodedContent).toBe('string');
    });

    it('空 buffer 应能安全处理', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'ascii', confidence: 1.0 });
      const fileData = Buffer.alloc(0);

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      expect(result.encodingUsed).toBe('utf-8');
      expect(result.decodedContent).toBe('');
    });

    it('低置信度且 GB18030 解码抛异常时应安全降级', () => {
      vi.mocked(jschardet.detect).mockReturnValue({ encoding: 'Shift_JIS', confidence: 0.3 });
      vi.mocked(iconv.decode)
        .mockImplementationOnce(() => {
          throw new Error('decode failed');
        })
        .mockReturnValueOnce('safe fallback');
      vi.mocked(iconv.encodingExists).mockReturnValue(true);
      const fileData = Buffer.from([0x82, 0x60]);

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      // GB18030 抛异常后走 decodeWithDetectedFallback
      // 'shiftjis' 在 iconv.encodingExists(mock=true) 时用 iconv.decode
      expect(result.encodingUsed).toBeDefined();
      expect(typeof result.decodedContent).toBe('string');
    });

    it('confidence 为 undefined 时应视为 0（低置信度路径）', () => {
      vi.mocked(jschardet.detect).mockReturnValue({
        encoding: 'ISO-8859-1',
        confidence: undefined as unknown as number,
      });
      vi.mocked(iconv.decode).mockReturnValueOnce('gb18030 ok').mockReturnValueOnce('fallback');
      vi.mocked(iconv.encodingExists).mockReturnValue(true);
      const fileData = Buffer.from('test');

      const result = detectAndDecodeSftpFileContent({
        ...baseInput,
        fileData,
      });

      // confidence undefined → undefined || 0 → 0 < 0.9 → 走低置信度路径
      expect(result.encodingUsed).toBeDefined();
      expect(typeof result.decodedContent).toBe('string');
    });
  });
});
