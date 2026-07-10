import { describe, it, expect } from 'vitest';
import { validateSafePath } from './sftp-path.utils';

describe('validateSafePath', () => {
  describe('应允许合法路径', () => {
    it('应允许简单的绝对路径', () => {
      expect(validateSafePath('/home/user/file.txt')).toBe(true);
    });

    it('应允许包含空格的路径', () => {
      expect(validateSafePath('/home/user/my files/data.txt')).toBe(true);
    });

    it('应允许包含括号的路径', () => {
      expect(validateSafePath('/home/user/project (backup)/data.txt')).toBe(true);
    });

    it('应允许包含连字符和下划线的路径', () => {
      expect(validateSafePath('/home/user/my-project/my_file.tar.gz')).toBe(true);
    });

    it('应允许包含点号的路径（多级扩展名）', () => {
      expect(validateSafePath('/data/archive.tar.gz')).toBe(true);
    });

    it('应允许相对路径（不含 ..）', () => {
      expect(validateSafePath('subdir/file.txt')).toBe(true);
    });

    it('应允许根路径', () => {
      expect(validateSafePath('/')).toBe(true);
    });

    it('应允许包含冒号的时间戳目录路径', () => {
      expect(
        validateSafePath('/home/honus/product/pve/backup/data/data/vm/100/2026-07-08T05:49:42Z'),
      ).toBe(true);
    });
  });

  describe('应拒绝路径穿越', () => {
    it('应拒绝包含 .. 的路径', () => {
      expect(validateSafePath('/home/user/../../../etc/passwd')).toBe(false);
    });

    it('应拒绝简单的 .. 路径', () => {
      expect(validateSafePath('../../etc')).toBe(false);
    });

    it('应拒绝中间包含 .. 的路径', () => {
      expect(validateSafePath('/home/user/../other/file')).toBe(false);
    });
  });

  describe('应拒绝 Shell 注入字符', () => {
    it('应拒绝包含反引号的路径', () => {
      expect(validateSafePath('/home/`whoami`/file.txt')).toBe(false);
    });

    it('应拒绝包含 $() 的路径', () => {
      expect(validateSafePath('/home/$(whoami)/file.txt')).toBe(false);
    });

    it('应拒绝包含 ${} 的路径', () => {
      expect(validateSafePath('/home/${HOME}/file.txt')).toBe(false);
    });

    it('应拒绝包含管道符的路径', () => {
      expect(validateSafePath('/home/user/file.txt|rm -rf /')).toBe(false);
    });

    it('应拒绝包含分号的路径', () => {
      expect(validateSafePath('/home/user/file.txt;rm -rf /')).toBe(false);
    });

    it('应拒绝包含 & 的路径', () => {
      expect(validateSafePath('/home/user/file.txt&malicious')).toBe(false);
    });

    it('应拒绝包含换行符的路径', () => {
      expect(validateSafePath('/home/user/file.txt\nrm -rf /')).toBe(false);
    });

    it('应拒绝包含回车符的路径', () => {
      expect(validateSafePath('/home/user/file.txt\rrm -rf /')).toBe(false);
    });
  });

  describe('应拒绝其他不安全字符', () => {
    it('应拒绝包含单引号的路径', () => {
      expect(validateSafePath("/home/user/file'name.txt")).toBe(false);
    });

    it('应拒绝包含双引号的路径', () => {
      expect(validateSafePath('/home/user/file"name.txt')).toBe(false);
    });

    it('应拒绝包含通配符的路径', () => {
      expect(validateSafePath('/home/user/*.txt')).toBe(false);
    });

    it('应拒绝包含方括号的路径', () => {
      expect(validateSafePath('/home/user/[abc]/file.txt')).toBe(false);
    });

    it('应拒绝包含 > 的路径', () => {
      expect(validateSafePath('/home/user/file.txt > /etc/passwd')).toBe(false);
    });

    it('应拒绝包含 < 的路径', () => {
      expect(validateSafePath('/home/user/file.txt < /etc/passwd')).toBe(false);
    });
  });

  describe('应拒绝以 - 开头的路径（防止参数注入）', () => {
    it('应拒绝以 - 开头的文件名', () => {
      expect(validateSafePath('-rf')).toBe(false);
    });

    it('应拒绝路径中包含以 - 开头的段', () => {
      expect(validateSafePath('/home/user/--dangerous')).toBe(false);
    });
  });

  describe('应拒绝边界情况', () => {
    it('应拒绝空字符串', () => {
      expect(validateSafePath('')).toBe(false);
    });

    it('应拒绝非字符串输入', () => {
      expect(validateSafePath(null as any)).toBe(false);
      expect(validateSafePath(undefined as any)).toBe(false);
      expect(validateSafePath(123 as any)).toBe(false);
    });
  });
});
