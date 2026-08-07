/**
 * 代码引用 i18n key 存在性守卫
 *
 * 背景：2026-08-07 打磨轮发现 72 个带 fallback 的 t('key', fallback) 调用其 key
 * 在三语言包中全部缺失，导致英文/日文用户看到中文 fallback 文案。
 * 语言包之间的 key 一致性测试抓不到这类问题（各语言包自身是"一致地缺失"），
 * 因此本测试直接从源码提取被引用的 key，与语言包比对，防止同类缺口复发。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import zhCN from '../zh-CN.json';

const SRC_ROOT = path.resolve(__dirname, '..', '..', '..', 'src');
const LOCALE_ROOT = path.resolve(__dirname, '..');

/** 递归收集 src 下所有 .vue / .ts 源码文件（排除测试与类型声明） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      /\.(vue|ts)$/.test(entry.name) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts') &&
      entry.name !== 'auto-imports.d.ts' &&
      entry.name !== 'components.d.ts'
    ) {
      out.push(full);
    }
  }
  return out;
}

/** 从源码提取 t('key') / $t('key') 引用的静态 key（含带 fallback 的调用） */
function extractI18nKeys(source: string): Set<string> {
  const keys = new Set<string>();
  // 匹配 t('xxx.yyy') 或 $t('xxx.yyy')，key 为不含空格的点分路径
  const pattern = /(?:\b(?:t|\$t)|\bt\()\s*\(\s*['"`]([a-zA-Z][a-zA-Z0-9_.]*)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const key = match[1];
    if (!key.includes(' ')) keys.add(key);
  }
  return keys;
}

/** 按点路径从语言包取值 */
function lookup(obj: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((current, part) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, obj);
}

describe('代码引用的 i18n key 存在性守卫', () => {
  const localeData = zhCN as Record<string, unknown>;

  it('源码引用的所有 key 必须存在于 zh-CN 语言包', () => {
    const files = collectSourceFiles(SRC_ROOT);
    const missing = new Map<string, string[]>();

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const key of extractI18nKeys(source)) {
        if (lookup(localeData, key) === undefined) {
          const refs = missing.get(key) ?? [];
          refs.push(path.relative(SRC_ROOT, file));
          missing.set(key, refs);
        }
      }
    }

    // 排除已知的非 i18n 误报：
    // - emit 事件名等短词（action/sort/close/saved/textarea）
    // - 动态模板拼接前缀（remoteDesktopModal.status.${state} 的子 key 已完整存在）
    const KNOWN_FALSE_POSITIVES = new Set([
      'action',
      'sort',
      'close',
      'saved',
      'textarea',
      'remoteDesktopModal.status.',
    ]);
    const realMissing = [...missing.entries()].filter(([key]) => !KNOWN_FALSE_POSITIVES.has(key));

    const detail = realMissing
      .map(([key, refs]) => `${key} <- ${refs.slice(0, 3).join(', ')}`)
      .join('\n');
    expect(realMissing, `缺失 key:\n${detail}`).toEqual([]);
  });

  it('语言包 key 应三语言完全一致（不允许漂移）', () => {
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

    const reference = flattenKeys(localeData).sort();
    for (const file of ['en-US.json', 'ja-JP.json']) {
      const other = JSON.parse(fs.readFileSync(path.join(LOCALE_ROOT, file), 'utf8')) as Record<
        string,
        unknown
      >;
      const otherKeys = flattenKeys(other).sort();
      const missing = reference.filter((k) => !otherKeys.includes(k));
      const extra = otherKeys.filter((k) => !reference.includes(k));
      expect(missing, `[${file}] 缺少 key: ${missing.join(', ')}`).toEqual([]);
      expect(extra, `[${file}] 多出 key: ${extra.join(', ')}`).toEqual([]);
    }
  });
});
