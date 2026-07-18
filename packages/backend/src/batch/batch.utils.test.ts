/**
 * 批量执行纯函数工具测试
 */
import { describe, it, expect } from 'vitest';
import { buildBatchCommand, DANGEROUS_CMD_PATTERN, sanitizeBatchCommand } from './batch.utils';
import type { BatchExecPayload } from './batch.types';

describe('batch.utils', () => {
  describe('sanitizeBatchCommand', () => {
    it('应保留合法 shell 语法', () => {
      expect(sanitizeBatchCommand('ls -la')).toBe('ls -la');
      expect(sanitizeBatchCommand('cat file | grep x')).toBe('cat file | grep x');
      expect(sanitizeBatchCommand('cd /tmp; ls')).toBe('cd /tmp; ls');
      expect(sanitizeBatchCommand('echo $USER')).toBe('echo $USER');
      expect(sanitizeBatchCommand('echo x > file')).toBe('echo x > file');
    });

    it('应 trim 首尾空白', () => {
      expect(sanitizeBatchCommand('  ls  ')).toBe('ls');
    });

    it('空值与非法类型应返回空串', () => {
      expect(sanitizeBatchCommand('')).toBe('');
      expect(sanitizeBatchCommand('   ')).toBe('');
      expect(sanitizeBatchCommand(null as unknown as string)).toBe('');
    });

    it('应拒绝命令替换与注入向量', () => {
      expect(sanitizeBatchCommand('echo `whoami`')).toBe('');
      expect(sanitizeBatchCommand('echo $(id)')).toBe('');
      expect(sanitizeBatchCommand('echo ${PATH}')).toBe('');
      expect(sanitizeBatchCommand("echo $'x'")).toBe('');
      expect(sanitizeBatchCommand('ls\nrm -rf /')).toBe('');
      expect(sanitizeBatchCommand('echo\x00evil')).toBe('');
      expect(sanitizeBatchCommand('{a,b}cp')).toBe('');
    });

    it('DANGEROUS_CMD_PATTERN 应匹配预期危险片段', () => {
      expect(DANGEROUS_CMD_PATTERN.test('$(id)')).toBe(true);
      expect(DANGEROUS_CMD_PATTERN.test('ls | wc')).toBe(false);
    });
  });

  describe('buildBatchCommand', () => {
    const base = (overrides: Partial<BatchExecPayload> = {}): BatchExecPayload =>
      ({
        connectionIds: [1],
        command: 'uptime',
        ...overrides,
      }) as BatchExecPayload;

    it('无附加选项时应返回原命令', () => {
      expect(buildBatchCommand('uptime', base())).toBe('uptime');
    });

    it('应包装 env', () => {
      const cmd = buildBatchCommand('echo hi', base({ env: { FOO: 'bar', A: "x'y" } }));
      expect(cmd).toContain('env ');
      expect(cmd).toContain("FOO='bar'");
      expect(cmd).toContain("A='x'\\''y'");
      expect(cmd.endsWith(' echo hi')).toBe(true);
    });

    it('应包装 sudo', () => {
      expect(buildBatchCommand('systemctl status nginx', base({ sudo: true }))).toBe(
        'sudo -n systemctl status nginx',
      );
    });

    it('应包装 workdir', () => {
      expect(buildBatchCommand('ls', base({ workdir: '/var/log' }))).toBe("cd '/var/log' && ls");
    });

    it('应按 env → sudo → workdir 顺序嵌套', () => {
      const cmd = buildBatchCommand(
        'id',
        base({
          env: { LANG: 'C' },
          sudo: true,
          workdir: '/tmp',
        }),
      );
      expect(cmd).toBe("cd '/tmp' && sudo -n env LANG='C' id");
    });
  });
});
