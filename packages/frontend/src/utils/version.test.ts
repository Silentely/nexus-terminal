/**
 * version 工具函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeVersion,
  isComparableVersion,
  compareVersions,
  isNewerVersion,
  buildReleaseTagUrl,
} from './version';

describe('version utils', () => {
  describe('normalizeVersion', () => {
    it('应去掉 v 前缀与空白', () => {
      expect(normalizeVersion('  v1.2.3  ')).toBe('1.2.3');
      expect(normalizeVersion('V2.0.0')).toBe('2.0.0');
      expect(normalizeVersion('1.0.0')).toBe('1.0.0');
    });
  });

  describe('isComparableVersion', () => {
    it('应接受合法 semver 风格版本', () => {
      expect(isComparableVersion('1.5.7')).toBe(true);
      expect(isComparableVersion('v1.5.7')).toBe(true);
      expect(isComparableVersion('1.0.0-beta.1')).toBe(true);
      expect(isComparableVersion('10.0')).toBe(true);
    });

    it('应拒绝 dev / 未知 / 空值', () => {
      expect(isComparableVersion('dev')).toBe(false);
      expect(isComparableVersion('未知版本')).toBe(false);
      expect(isComparableVersion('')).toBe(false);
      expect(isComparableVersion(null)).toBe(false);
      expect(isComparableVersion(undefined)).toBe(false);
      expect(isComparableVersion('latest')).toBe(false);
    });
  });

  describe('compareVersions', () => {
    it('应按数值比较各段', () => {
      expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
      expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
      expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('应正确处理 v 前缀', () => {
      expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
      expect(compareVersions('v2.0.0', 'v1.9.0')).toBeGreaterThan(0);
    });

    it('正式版应高于同号 pre-release', () => {
      expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    });
  });

  describe('isNewerVersion', () => {
    it('远程更新时应返回 true', () => {
      expect(isNewerVersion('1.5.8', '1.5.7')).toBe(true);
      expect(isNewerVersion('v2.0.0', '1.9.0')).toBe(true);
    });

    it('相同或更旧时返回 false', () => {
      expect(isNewerVersion('1.5.7', '1.5.7')).toBe(false);
      expect(isNewerVersion('1.5.6', '1.5.7')).toBe(false);
    });

    it('不可比较版本不应误报更新', () => {
      expect(isNewerVersion('1.5.7', 'dev')).toBe(false);
      expect(isNewerVersion('dev', '1.5.7')).toBe(false);
      expect(isNewerVersion(null, '1.5.7')).toBe(false);
    });
  });

  describe('buildReleaseTagUrl', () => {
    it('应补全 v 前缀并拼接 releases/tag', () => {
      expect(buildReleaseTagUrl('https://github.com/org/repo', '1.5.7')).toBe(
        'https://github.com/org/repo/releases/tag/v1.5.7',
      );
      expect(buildReleaseTagUrl('https://github.com/org/repo/', 'v1.5.7')).toBe(
        'https://github.com/org/repo/releases/tag/v1.5.7',
      );
    });
  });
});
