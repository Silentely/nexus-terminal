/**
 * useFileManagerContextMenu 防御性守卫单元测试
 * 直接测试从源码导出的 resolveMenuElement 函数
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveMenuElement } from './useFileManagerContextMenu';

describe('useFileManagerContextMenu - resolveMenuElement 防御性守卫', () => {
  describe('null / undefined 输入', () => {
    it('当 rawRef 为 null 时应返回 null', () => {
      expect(resolveMenuElement(null)).toBeNull();
    });

    it('当 rawRef 为 undefined 时应返回 null', () => {
      expect(resolveMenuElement(undefined)).toBeNull();
    });
  });

  describe('直接 HTMLElement 输入', () => {
    it('当 rawRef 为 HTMLElement 时应直接返回', () => {
      const div = document.createElement('div');
      expect(resolveMenuElement(div)).toBe(div);
    });

    it('当 rawRef 为 HTMLSpanElement 时应直接返回', () => {
      const span = document.createElement('span');
      expect(resolveMenuElement(span)).toBe(span);
    });
  });

  describe('Vue 组件实例输入（含 $el）', () => {
    it('当 rawRef 为组件实例且 $el 为 HTMLElement 时应返回 $el', () => {
      const div = document.createElement('div');
      const componentInstance = { $el: div, someMethod: () => {} };
      expect(resolveMenuElement(componentInstance)).toBe(div);
    });

    it('当 rawRef 为组件实例且 $el 为文本节点时应返回 null', () => {
      const textNode = document.createTextNode('hello');
      const componentInstance = { $el: textNode };
      expect(resolveMenuElement(componentInstance)).toBeNull();
    });

    it('当 rawRef 为组件实例且 $el 为 null 时应返回 null', () => {
      const componentInstance = { $el: null };
      expect(resolveMenuElement(componentInstance)).toBeNull();
    });

    it('当 rawRef 为组件实例且 $el 为 undefined 时应返回 null', () => {
      const componentInstance = { $el: undefined };
      expect(resolveMenuElement(componentInstance)).toBeNull();
    });
  });

  describe('无效输入类型', () => {
    it('当 rawRef 为普通对象（无 $el）时应返回 null', () => {
      expect(resolveMenuElement({ foo: 'bar' })).toBeNull();
    });

    it('当 rawRef 为数字时应返回 null', () => {
      expect(resolveMenuElement(42)).toBeNull();
    });

    it('当 rawRef 为字符串时应返回 null', () => {
      expect(resolveMenuElement('hello')).toBeNull();
    });

    it('当 rawRef 为函数时应返回 null', () => {
      expect(resolveMenuElement(() => {})).toBeNull();
    });
  });

  describe('getBoundingClientRect 调用安全性', () => {
    it('HTMLElement 上调用 getBoundingClientRect 应正常返回', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const element = resolveMenuElement(div);
      expect(element).toBeInstanceOf(HTMLElement);
      expect(() => element?.getBoundingClientRect()).not.toThrow();

      document.body.removeChild(div);
    });

    it('null 元素时应跳过 getBoundingClientRect 调用', () => {
      const element = resolveMenuElement(null);
      expect(element).toBeNull();
      // 模拟 composable 中的条件：if (menuElement instanceof HTMLElement)
      const getBoundingClientRectSpy = vi.fn();
      if (element instanceof HTMLElement) {
        getBoundingClientRectSpy();
      }
      expect(getBoundingClientRectSpy).not.toHaveBeenCalled();
    });

    it('非 HTMLElement 的组件实例应被安全过滤，不触发 getBoundingClientRect', () => {
      const fakeComponent = { render: () => {}, setup: () => {} };
      const element = resolveMenuElement(fakeComponent);
      expect(element).toBeNull();

      const getBoundingClientRectSpy = vi.fn();
      if (element instanceof HTMLElement) {
        getBoundingClientRectSpy();
      }
      expect(getBoundingClientRectSpy).not.toHaveBeenCalled();
    });
  });
});
