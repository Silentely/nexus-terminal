import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';

interface DetectAndDecodeInput {
  fileData: Buffer;
  requestedEncoding?: string;
  sessionId: string;
  remotePath: string;
  requestId: string;
}

interface DetectAndDecodeResult {
  encodingUsed: string;
  decodedContent: string;
}

const normalizeEncodingName = (encoding: string): string =>
  encoding.toLowerCase().replace(/[^a-z0-9]/g, '');

const decodeWithDetectedFallback = (
  fileData: Buffer,
  normalizedDetected: string,
  sessionId: string,
  remotePath: string,
): DetectAndDecodeResult => {
  if (iconv.encodingExists(normalizedDetected)) {
    const encodingUsed = normalizedDetected;
    const decodedContent = iconv.decode(fileData, encodingUsed);
    logger.debug(
      `[SFTP ${sessionId}] Falling back to decoding ${remotePath} as originally detected ${encodingUsed}.`,
    );
    return { encodingUsed, decodedContent };
  }

  const encodingUsed = 'utf-8';
  const decodedContent = fileData.toString('utf8');
  logger.debug(`[SFTP ${sessionId}] Falling back to decoding ${remotePath} as UTF-8.`);
  return { encodingUsed, decodedContent };
};

export const detectAndDecodeSftpFileContent = ({
  fileData,
  requestedEncoding,
  sessionId,
  remotePath,
  requestId,
}: DetectAndDecodeInput): DetectAndDecodeResult => {
  let encodingUsed = 'utf-8';
  let decodedContent = '';

  if (requestedEncoding) {
    encodingUsed = requestedEncoding;
    logger.debug(
      `[SFTP ${sessionId}] Using requested encoding: ${encodingUsed} (ID: ${requestId})`,
    );
    const normalizedEncoding = normalizeEncodingName(encodingUsed);
    if (iconv.encodingExists(normalizedEncoding)) {
      decodedContent = iconv.decode(fileData, normalizedEncoding);
      encodingUsed = normalizedEncoding;
    } else {
      logger.warn(
        `[SFTP ${sessionId}] Requested encoding "${requestedEncoding}" is not supported by iconv-lite. Falling back to UTF-8. (ID: ${requestId})`,
      );
      encodingUsed = 'utf-8';
      decodedContent = iconv.decode(fileData, encodingUsed);
    }
  } else {
    logger.debug(`[SFTP ${sessionId}] Detecting encoding for ${remotePath} (ID: ${requestId})`);
    const detection = jschardet.detect(fileData);
    const detectedEncodingRaw = detection.encoding ? detection.encoding.toLowerCase() : 'utf-8';
    const confidence = detection.confidence || 0;
    logger.debug(
      `[SFTP ${sessionId}] Detected encoding: ${detectedEncodingRaw} (confidence: ${confidence})`,
    );

    const chineseEncodings = ['gbk', 'gb2312', 'gb18030', 'big5', 'euc-tw'];
    let normalizedDetected = normalizeEncodingName(detectedEncodingRaw);
    if (normalizedDetected === 'windows1252') normalizedDetected = 'cp1252';
    else if (normalizedDetected === 'gb2312') normalizedDetected = 'gbk';

    if (normalizedDetected === 'utf8' || normalizedDetected === 'ascii') {
      encodingUsed = 'utf-8';
      decodedContent = fileData.toString('utf8');
      logger.debug(`[SFTP ${sessionId}] Decoded ${remotePath} as UTF-8/ASCII.`);
    } else if (chineseEncodings.includes(normalizedDetected)) {
      encodingUsed = 'gb18030';
      decodedContent = iconv.decode(fileData, encodingUsed);
      logger.debug(
        `[SFTP ${sessionId}] Decoded ${remotePath} from detected Chinese encoding (${normalizedDetected}) as ${encodingUsed}.`,
      );
    } else if (confidence < 0.9) {
      logger.warn(
        `[SFTP ${sessionId}] Low confidence detection (${normalizedDetected}, ${confidence}) for ${remotePath}. Attempting GB18030 decode first.`,
      );
      try {
        const gb18030Content = iconv.decode(fileData, 'gb18030');
        if (gb18030Content.includes('\uFFFD')) {
          logger.warn(
            `[SFTP ${sessionId}] GB18030 decoding resulted in replacement characters. Falling back to original detection (${normalizedDetected}) or UTF-8.`,
          );
          const fallbackResult = decodeWithDetectedFallback(
            fileData,
            normalizedDetected,
            sessionId,
            remotePath,
          );
          encodingUsed = fallbackResult.encodingUsed;
          decodedContent = fallbackResult.decodedContent;
        } else {
          encodingUsed = 'gb18030';
          decodedContent = gb18030Content;
          logger.debug(
            `[SFTP ${sessionId}] Decoded ${remotePath} as ${encodingUsed} due to low confidence detection.`,
          );
        }
      } catch (decodeError: unknown) {
        logger.warn(
          `[SFTP ${sessionId}] Error decoding as GB18030, falling back to original detection (${normalizedDetected}) or UTF-8: ${getErrorMessage(decodeError)}`,
        );
        const fallbackResult = decodeWithDetectedFallback(
          fileData,
          normalizedDetected,
          sessionId,
          remotePath,
        );
        encodingUsed = fallbackResult.encodingUsed;
        decodedContent = fallbackResult.decodedContent;
      }
    } else if (iconv.encodingExists(normalizedDetected)) {
      encodingUsed = normalizedDetected;
      decodedContent = iconv.decode(fileData, encodingUsed);
      logger.debug(
        `[SFTP ${sessionId}] Decoded ${remotePath} from ${encodingUsed} using iconv-lite (high confidence).`,
      );
    } else {
      logger.warn(
        `[SFTP ${sessionId}] Unsupported or unknown encoding detected for ${remotePath}: ${normalizedDetected}. Falling back to UTF-8.`,
      );
      encodingUsed = 'utf-8';
      decodedContent = fileData.toString('utf8');
    }
  }

  if (decodedContent.includes('\uFFFD')) {
    logger.warn(
      `[SFTP ${sessionId}] Final decoded content for ${remotePath} (using ${encodingUsed}) contains replacement characters (U+FFFD). Decoding might be incorrect. (ID: ${requestId})`,
    );
  }

  return { encodingUsed, decodedContent };
};
