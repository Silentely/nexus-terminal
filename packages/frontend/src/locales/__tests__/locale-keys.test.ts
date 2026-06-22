import { describe, it, expect, vi } from 'vitest';
import zhCN from '../zh-CN.json';
import enUS from '../en-US.json';
import jaJP from '../ja-JP.json';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

/**
 * 递归提取嵌套对象中所有叶节点的 key 路径
 */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('翻译完整性校验', () => {
  const locales = {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
  } as const;

  const localeEntries = Object.entries(locales);

  for (const [localeName, localeData] of localeEntries) {
    describe(localeName, () => {
      it('应该与 zh-CN 保持 key 一致性', () => {
        const referenceKeys = flattenKeys(zhCN as Record<string, unknown>).sort();
        const currentKeys = flattenKeys(localeData as Record<string, unknown>).sort();

        const missingInCurrent = referenceKeys.filter((k) => !currentKeys.includes(k));
        const extraInCurrent = currentKeys.filter((k) => !referenceKeys.includes(k));

        if (missingInCurrent.length > 0) {
          mockLog.warn(
            `[${localeName}] 缺少 ${missingInCurrent.length} 个 key:`,
            missingInCurrent.slice(0, 10),
          );
        }
        if (extraInCurrent.length > 0) {
          mockLog.warn(
            `[${localeName}] 多出 ${extraInCurrent.length} 个 key:`,
            extraInCurrent.slice(0, 10),
          );
        }

        // 允许少量差异（新旧翻译可能有延迟同步），但差异不应超过 5%
        const totalKeys = referenceKeys.length;
        const diffCount = missingInCurrent.length + extraInCurrent.length;
        const diffRatio = diffCount / totalKeys;

        expect(diffRatio).toBeLessThanOrEqual(0.05);
      });

      it('不应该有空值翻译', () => {
        const keys = flattenKeys(localeData as Record<string, unknown>);
        const emptyKeys = keys.filter((key) => {
          const parts = key.split('.');
          let current: unknown = localeData;
          for (const part of parts) {
            if (typeof current !== 'object' || current === null) return false;
            current = (current as Record<string, unknown>)[part];
          }
          return current === '' || current === null || current === undefined;
        });

        expect(emptyKeys).toEqual([]);
      });
    });
  }
});
