import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';

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

/**
 * 检查 JSON 源文件中同一对象作用域内是否存在重复 key。
 *
 * JSON.parse 会在解析时静默折叠重复 key（last-wins），因此只能基于
 * 原始文件文本检测。这里用缩进推断作用域：每行 key 前的空格数代表嵌套深度，
 * 同一深度内同一 key 出现两次即视为重复。
 */
function findDuplicateKeysInSource(filePath: string): string[] {
  const raw = fs.readFileSync(path.join(__dirname, filePath), 'utf8');
  const duplicates: string[] = [];
  // 缩进 → 该缩进层已出现的 key 集合
  const seenAtIndent = new Map<number, Set<string>>();
  // 当前缩进栈（用于计算"距行首缩进"）
  const indentStack: number[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    // 仅匹配 "key": 形式的行（含嵌套对象与叶子值）
    const match = trimmed.match(/^"([^"]+)":/);
    if (!match) continue;
    const key = match[1];
    const indent = line.length - line.trimStart().length;

    // 维护缩进栈：弹出所有比当前行更深（或相等）的层级
    while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1]) {
      const poppedIndent = indentStack.pop();
      if (poppedIndent !== undefined) seenAtIndent.delete(poppedIndent);
    }

    const seen = seenAtIndent.get(indent) ?? new Set<string>();
    if (seen.has(key)) {
      duplicates.push(`${key} (缩进 ${indent})`);
    } else {
      seen.add(key);
    }
    seenAtIndent.set(indent, seen);
    indentStack.push(indent);
  }
  return duplicates;
}

describe('后端语言包完整性校验', () => {
  const locales = {
    'zh-CN': zhCN as Record<string, unknown>,
    'en-US': enUS as Record<string, unknown>,
    'ja-JP': jaJP as Record<string, unknown>,
  } as const;

  const referenceKeys = flattenKeys(locales['en-US']).sort();

  it('三语言 key 集合应完全一致（无缺失、无多余）', () => {
    for (const [localeName, localeData] of Object.entries(locales)) {
      const currentKeys = flattenKeys(localeData).sort();
      const missingInCurrent = referenceKeys.filter((k) => !currentKeys.includes(k));
      const extraInCurrent = currentKeys.filter((k) => !referenceKeys.includes(k));

      expect(missingInCurrent, `[${localeName}] 缺少 key: ${missingInCurrent.join(', ')}`).toEqual(
        [],
      );
      expect(extraInCurrent, `[${localeName}] 多出 key: ${extraInCurrent.join(', ')}`).toEqual([]);
    }
  });

  it('不应存在空值翻译', () => {
    for (const [localeName, localeData] of Object.entries(locales)) {
      const emptyKeys = flattenKeys(localeData).filter((key) => {
        const parts = key.split('.');
        let current: unknown = localeData;
        for (const part of parts) {
          if (typeof current !== 'object' || current === null) return false;
          current = (current as Record<string, unknown>)[part];
        }
        return current === '' || current === null || current === undefined;
      });

      expect(emptyKeys, `[${localeName}] 空值 key: ${emptyKeys.join(', ')}`).toEqual([]);
    }
  });

  it('不应存在同一作用域重复 key（基于源文件文本检测）', () => {
    const localeFiles = ['zh-CN.json', 'en-US.json', 'ja-JP.json'];
    for (const file of localeFiles) {
      const duplicates = findDuplicateKeysInSource(`./locales/${file}`);
      expect(duplicates, `[${file}] 重复 key: ${duplicates.join(', ')}`).toEqual([]);
    }
  });

  it('通知测试模板 key 必须存在（notification.service 依赖）', () => {
    const requiredKeys = [
      'testNotification.subject',
      'testNotification.email.body',
      'testNotification.email.bodyHtml',
      'testNotification.webhook.detailsMessage',
      'testNotification.telegram.detailsMessage',
      'testNotification.telegram.bodyTemplate',
    ];
    for (const [localeName, localeData] of Object.entries(locales)) {
      const currentKeys = flattenKeys(localeData);
      for (const key of requiredKeys) {
        expect(currentKeys.includes(key), `[${localeName}] 缺少通知测试模板 key: ${key}`).toBe(
          true,
        );
      }
    }
  });
});
