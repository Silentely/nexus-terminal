// packages/frontend/src/stores/session/utils.ts

import * as iconv from '@vscode/iconv-lite-umd';
import { Buffer } from 'buffer/';

/**
 * 生成唯一的会话 ID。
 * @returns {string} 新的会话 ID。
 */
export function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * 根据文件名获取 Monaco Editor 对应的语言标识符。
 * @param {string} filename - 文件名。
 * @returns {string} 语言标识符，默认为 'plaintext'。
 */
export const getLanguageFromFilename = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'py':
      return 'python';
    case 'java':
      return 'java';
    case 'c':
      return 'c';
    case 'cpp':
      return 'cpp';
    case 'cs':
      return 'csharp';
    case 'go':
      return 'go';
    case 'php':
      return 'php';
    case 'rb':
      return 'ruby';
    case 'rs':
      return 'rust';
    case 'sql':
      return 'sql';
    case 'sh':
      return 'shell';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'md':
      return 'markdown';
    case 'xml':
      return 'xml';
    case 'ini':
      return 'ini';
    case 'bat':
      return 'bat';
    case 'dockerfile':
      return 'dockerfile';
    default:
      return 'plaintext';
  }
};

/**
 * 使用指定的编码解码 Base64 编码的原始文件内容。
 * @param {string} rawContentBase64 - Base64 编码的原始文件内容。
 * @param {string} encoding - 用于解码的字符编码。
 * @returns {string} 解码后的文件内容。如果解码失败，则返回错误信息。
 */
export const decodeRawContent = (rawContentBase64: string, encoding: string): string => {
  try {
    const buffer = Buffer.from(rawContentBase64, 'base64');
    const normalizedEncoding = encoding.toLowerCase().replace(/[^a-z0-9]/g, ''); // 标准化编码名称

    // 优先使用 TextDecoder 处理标准编码
    if (['utf8', 'utf16le', 'utf16be'].includes(normalizedEncoding)) {
      const decoder = new TextDecoder(encoding); // TextDecoder 使用原始编码名称
      return decoder.decode(buffer);
    }
    // 使用 iconv-lite 处理其他编码
    if (iconv.encodingExists(normalizedEncoding)) {
      return iconv.decode(buffer, normalizedEncoding);
    }
    // 如果 iconv-lite 也不支持，回退到 UTF-8 并警告

    console.warn(
      `[SessionUtils decodeRawContent] Unsupported encoding "${encoding}" requested. Falling back to UTF-8.`
    );
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  } catch (error: any) {
    console.error(
      `[SessionUtils decodeRawContent] Error decoding content with encoding "${encoding}":`,
      error
    );
    return `// Error decoding content: ${error.message}`; // 返回错误信息
  }
};
