/**
 * Vitest 测试环境配置 - Frontend
 */
import { vi, beforeAll, afterAll, afterEach } from 'vitest';
import { config } from '@vue/test-utils';

// 全局 mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// 全局 mock sessionStorage
const sessionStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
};
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock ResizeObserver
class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
}
Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverMock });

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// Mock IntersectionObserver
class IntersectionObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
}
Object.defineProperty(window, 'IntersectionObserver', { value: IntersectionObserverMock });

// 配置 Vue Test Utils
config.global.stubs = {
    teleport: true,
    transition: false,
};

// 清理所有 mock
afterEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
});

beforeAll(() => {
    console.log('🧪 Frontend test environment initialized');
});

afterAll(() => {
    console.log('🧪 Frontend test cleanup complete');
});
