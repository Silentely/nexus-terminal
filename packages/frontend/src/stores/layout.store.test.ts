import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useLayoutStore } from './layout.store';

// Mock apiClient to prevent actual network calls during store initialization
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/settings/nav-bar-visibility') {
        return Promise.resolve({ data: { visible: true } });
      }
      return Promise.resolve({ data: null });
    }),
    put: vi.fn(() => Promise.resolve({ data: null })),
  },
}));

describe('layout.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('allPossiblePanes should include batchExec', () => {
    const store = useLayoutStore();
    expect(store.allPossiblePanes).toContain('batchExec');
  });
});
