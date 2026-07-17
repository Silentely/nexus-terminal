/**
 * SSH handler 纯函数工具测试
 */
import { describe, it, expect } from 'vitest';
import {
  consumeSuppressedPromptChunk,
  extractAbsolutePathFromSilentLine,
  hasAbsolutePathInOutput,
  isAbsolutePath,
  isLikelyShellPromptLine,
  isSilentExecOutputAccepted,
  isValidSshResizeDims,
  normalizeSilentExecSuccessCriteria,
  resolveSshInputData,
  stripTerminalControlSequences,
  SSH_RESIZE_MAX_COLS,
  SSH_RESIZE_MAX_ROWS,
} from './ssh-handler.utils';

describe('ssh-handler.utils', () => {
  describe('isValidSshResizeDims', () => {
    it('应接受合法尺寸', () => {
      expect(isValidSshResizeDims(80, 24)).toBe(true);
      expect(isValidSshResizeDims(SSH_RESIZE_MAX_COLS, SSH_RESIZE_MAX_ROWS)).toBe(true);
    });

    it('应拒绝越界与非法值', () => {
      expect(isValidSshResizeDims(0, 24)).toBe(false);
      expect(isValidSshResizeDims(80, 0)).toBe(false);
      expect(isValidSshResizeDims(-1, 24)).toBe(false);
      expect(isValidSshResizeDims(SSH_RESIZE_MAX_COLS + 1, 24)).toBe(false);
      expect(isValidSshResizeDims(80, SSH_RESIZE_MAX_ROWS + 1)).toBe(false);
      expect(isValidSshResizeDims('80', 24)).toBe(false);
      expect(isValidSshResizeDims(80, '24')).toBe(false);
      expect(isValidSshResizeDims(undefined, undefined)).toBe(false);
      expect(isValidSshResizeDims(80.5, 24)).toBe(false);
      expect(isValidSshResizeDims(80, Number.NaN)).toBe(false);
    });
  });

  describe('isAbsolutePath / extractAbsolutePathFromSilentLine', () => {
    it('应识别 POSIX 与 Windows 绝对路径', () => {
      expect(isAbsolutePath('/home/user')).toBe(true);
      expect(isAbsolutePath('C:\\Users')).toBe(true);
      expect(isAbsolutePath('d:/data')).toBe(true);
      expect(isAbsolutePath('relative/path')).toBe(false);
    });

    it('应支持 __NX_PWD__ 前缀并剥离 ANSI', () => {
      expect(extractAbsolutePathFromSilentLine('__NX_PWD__/tmp')).toBe('/tmp');
      expect(extractAbsolutePathFromSilentLine('\x1B[32m/var/log\x1B[0m')).toBe('/var/log');
      expect(extractAbsolutePathFromSilentLine('not a path')).toBeNull();
      expect(extractAbsolutePathFromSilentLine('')).toBeNull();
    });
  });

  describe('hasAbsolutePathInOutput / isSilentExecOutputAccepted', () => {
    it('应在多行输出中查找绝对路径', () => {
      expect(hasAbsolutePathInOutput('ok\n/home/a\n')).toBe(true);
      expect(hasAbsolutePathInOutput('no path here')).toBe(false);
    });

    it('应按 criteria 判定', () => {
      expect(isSilentExecOutputAccepted('any', '')).toBe(true);
      expect(isSilentExecOutputAccepted('non_empty', '  ')).toBe(false);
      expect(isSilentExecOutputAccepted('non_empty', 'x')).toBe(true);
      expect(isSilentExecOutputAccepted('absolute_path', 'hi')).toBe(false);
      expect(isSilentExecOutputAccepted('absolute_path', '/etc')).toBe(true);
    });
  });

  describe('normalizeSilentExecSuccessCriteria', () => {
    it('合法值透传，非法值回退 non_empty', () => {
      expect(normalizeSilentExecSuccessCriteria('any')).toBe('any');
      expect(normalizeSilentExecSuccessCriteria('absolute_path')).toBe('absolute_path');
      expect(normalizeSilentExecSuccessCriteria('non_empty')).toBe('non_empty');
      expect(normalizeSilentExecSuccessCriteria('other')).toBe('non_empty');
      expect(normalizeSilentExecSuccessCriteria(null)).toBe('non_empty');
    });
  });

  describe('stripTerminalControlSequences / isLikelyShellPromptLine', () => {
    it('应剥离 ANSI 序列', () => {
      expect(stripTerminalControlSequences('\x1B[31mred\x1B[0m')).toBe('red');
    });

    it('应识别常见 shell 提示符', () => {
      expect(isLikelyShellPromptLine('user@host:/tmp$')).toBe(true);
      expect(isLikelyShellPromptLine('C:\\Users\\me>')).toBe(true);
      expect(isLikelyShellPromptLine('hello world')).toBe(false);
    });
  });

  describe('consumeSuppressedPromptChunk', () => {
    it('整行提示符应吞掉并结束抑制', () => {
      const r = consumeSuppressedPromptChunk('user@host:~$');
      expect(r.output).toBe('');
      expect(r.consumedPrompt).toBe(true);
      expect(r.keepSuppression).toBe(false);
    });

    it('提示符 + 后续输出应只丢弃首行', () => {
      const r = consumeSuppressedPromptChunk('user@host:~$\nls output\n');
      expect(r.output).toBe('ls output\n');
      expect(r.consumedPrompt).toBe(true);
    });

    it('空 chunk 应保持抑制', () => {
      const r = consumeSuppressedPromptChunk('');
      expect(r.keepSuppression).toBe(true);
      expect(r.consumedPrompt).toBe(false);
    });
  });

  describe('resolveSshInputData', () => {
    it('应解析 string 与 { data } 形态', () => {
      expect(resolveSshInputData('hello')).toBe('hello');
      expect(resolveSshInputData({ data: 'x' })).toBe('x');
      expect(resolveSshInputData({ data: 1 })).toBeNull();
      expect(resolveSshInputData(null)).toBeNull();
      expect(resolveSshInputData({})).toBeNull();
    });
  });
});
