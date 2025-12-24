/**
 * Monaco Editor Mock
 * 用于测试环境的 Monaco Editor 模拟实现
 */
import { vi } from 'vitest';

// Mock editor instance factory
export function createMockEditorInstance() {
  return {
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
    addAction: vi.fn(),
    getModel: vi.fn(() => ({})),
    updateOptions: vi.fn(),
    getOption: vi.fn(() => 14),
    setScrollPosition: vi.fn(),
    getScrollTop: vi.fn(() => 0),
    getScrollLeft: vi.fn(() => 0),
    getDomNode: vi.fn(() => document.createElement('div')),
  };
}

export const editor = {
  create: vi.fn(() => createMockEditorInstance()),
  setModelLanguage: vi.fn(),
  setTheme: vi.fn(),
  EditorOption: {
    fontSize: 52,
  },
};

export const KeyMod = {
  CtrlCmd: 2048,
};

export const KeyCode = {
  KeyS: 49,
};

export default {
  editor,
  KeyMod,
  KeyCode,
};
