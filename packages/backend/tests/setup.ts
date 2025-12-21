/**
 * Vitest 测试环境配置
 */
import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// 模拟环境变量
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
process.env.SESSION_SECRET = 'test-session-secret';

// 全局 mock 常用模块
vi.mock('../src/database/connection', () => ({
    getDbInstance: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({ changes: 1 }),
        get: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue([]),
    }),
}));

// 清理所有 mock
afterEach(() => {
    vi.clearAllMocks();
});

beforeAll(() => {
    console.log('🧪 Backend test environment initialized');
});

afterAll(() => {
    console.log('🧪 Backend test cleanup complete');
});
