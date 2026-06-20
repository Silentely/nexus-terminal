import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../utils', () => ({
  getLanguageFromFilename: vi.fn((filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      py: 'python',
      json: 'json',
      md: 'markdown',
    };
    return map[ext ?? ''] ?? 'plaintext';
  }),
  decodeRawContent: vi.fn((base64: string, _encoding: string) => {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }),
}));

const { mockSessionsMap } = vi.hoisted(() => ({
  mockSessionsMap: new Map(),
}));

vi.mock('../state', () => ({
  sessions: {
    get value() {
      return mockSessionsMap;
    },
  },
}));

import {
  openFileInSession,
  reloadTabInSession,
  closeEditorTabInSession,
  setActiveEditorTabInSession,
  updateFileContentInSession,
  saveFileInSession,
  changeEncodingInSession,
  closeOtherTabsInSession,
  closeTabsToTheRightInSession,
  closeTabsToTheLeftInSession,
  updateTabScrollPositionInSession,
} from './editorActions';
import { log } from '@/utils/log';
import { getLanguageFromFilename } from '../utils';
import type { FileTab } from '../types';

/** 创建模拟标签页 */
const createMockTab = (
  overrides: Partial<FileTab> & { id: string; filePath: string; filename: string },
): FileTab => ({
  sessionId: 's1',
  content: '',
  originalContent: '',
  rawContentBase64: null,
  language: 'plaintext',
  selectedEncoding: 'utf-8',
  lineEnding: 'lf',
  isLoading: false,
  loadingError: null,
  isSaving: false,
  saveStatus: 'idle' as const,
  saveError: null,
  isModified: false,
  scrollTop: 0,
  scrollLeft: 0,
  ...overrides,
});

/** 创建模拟会话 */
const createMockSession = (sessionId = 's1') => ({
  sessionId,
  editorTabs: ref<FileTab[]>([]),
  activeEditorTabId: ref<string | null>(null),
  wsManager: {
    isConnected: ref(true),
    isSftpReady: ref(true),
  },
  sftpManagers: new Map(),
});

/** 设置 sessions Map */
const setSession = (session: ReturnType<typeof createMockSession>) => {
  mockSessionsMap.set(session.sessionId, session);
};

const mockT = ((key: string, ...args: unknown[]) => {
  const last = args[args.length - 1];
  return typeof last === 'string' ? last : key;
}) as unknown as (key: string) => string;
const mockDependencies = () => ({
  getOrCreateSftpManager: vi.fn(),
  t: mockT,
});

describe('session/actions/editorActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionsMap.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('openFileInSession', () => {
    it('会话不存在时应输出错误日志', () => {
      openFileInSession(
        'nonexistent',
        { name: 'test.ts', fullPath: '/test.ts' },
        mockDependencies(),
      );
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('不存在的会话 nonexistent'));
    });

    it('文件已存在时应激活已有标签页', () => {
      const session = createMockSession();
      const existingTab = createMockTab({
        id: 's1:/test.ts',
        filePath: '/test.ts',
        filename: 'test.ts',
      });
      session.editorTabs.value.push(existingTab);
      setSession(session);

      const deps = mockDependencies();
      openFileInSession('s1', { name: 'test.ts', fullPath: '/test.ts' }, deps);

      expect(session.activeEditorTabId.value).toBe('s1:/test.ts');
      expect(deps.getOrCreateSftpManager).not.toHaveBeenCalled();
    });

    it('新文件应创建标签页并触发内容加载', async () => {
      const session = createMockSession();
      setSession(session);

      const sftpManager = {
        readFile: vi.fn().mockResolvedValue({
          rawContentBase64: Buffer.from('hello').toString('base64'),
          encodingUsed: 'utf-8',
        }),
      };
      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue(sftpManager);

      openFileInSession('s1', { name: 'test.ts', fullPath: '/test.ts' }, deps);

      expect(session.editorTabs.value).toHaveLength(1);
      expect(session.activeEditorTabId.value).toBe('s1:/test.ts');
      expect(session.editorTabs.value[0].isLoading).toBe(true);

      // 等待异步内容加载完成
      await vi.advanceTimersByTimeAsync(0);

      expect(session.editorTabs.value[0].isLoading).toBe(false);
      expect(session.editorTabs.value[0].content).toBe('hello');
      expect(session.editorTabs.value[0].isModified).toBe(false);
    });

    it('应根据文件名推断语言', () => {
      const session = createMockSession();
      setSession(session);
      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue({
        readFile: vi.fn().mockResolvedValue({ rawContentBase64: '', encodingUsed: 'utf-8' }),
      });

      openFileInSession('s1', { name: 'app.py', fullPath: '/app.py' }, deps);

      expect(getLanguageFromFilename).toHaveBeenCalledWith('app.py');
      expect(session.editorTabs.value[0].language).toBe('python');
    });

    it('SFTP 管理器为 null 时应设置加载错误', async () => {
      const session = createMockSession();
      setSession(session);

      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue(null);

      openFileInSession('s1', { name: 'test.ts', fullPath: '/test.ts' }, deps);
      await vi.advanceTimersByTimeAsync(0);

      expect(session.editorTabs.value[0].isLoading).toBe(false);
      expect(session.editorTabs.value[0].loadingError).toBeTruthy();
    });

    it('读取文件失败时应设置加载错误', async () => {
      const session = createMockSession();
      setSession(session);

      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue({
        readFile: vi.fn().mockRejectedValue(new Error('读取失败')),
      });

      openFileInSession('s1', { name: 'test.ts', fullPath: '/test.ts' }, deps);
      await vi.advanceTimersByTimeAsync(0);

      expect(session.editorTabs.value[0].isLoading).toBe(false);
      expect(session.editorTabs.value[0].loadingError).toContain('读取失败');
    });
  });

  describe('reloadTabInSession', () => {
    it('会话不存在时应输出错误日志', async () => {
      await reloadTabInSession('nonexistent', 'tab1', mockDependencies());
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('不存在的会话 nonexistent'));
    });

    it('标签页不存在时应输出警告日志', async () => {
      const session = createMockSession();
      setSession(session);

      await reloadTabInSession('s1', 'nonexistent', mockDependencies());
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的标签页 nonexistent'));
    });

    it('标签页正在保存时应跳过刷新', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isSaving: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      await reloadTabInSession('s1', 'tab1', mockDependencies());
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('正在保存'));
    });

    it('正常刷新应重新加载文件内容', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        content: 'old',
        originalContent: 'old',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue({
        readFile: vi.fn().mockResolvedValue({
          rawContentBase64: Buffer.from('new content').toString('base64'),
          encodingUsed: 'utf-8',
        }),
      });

      await reloadTabInSession('s1', 'tab1', deps);
      await vi.advanceTimersByTimeAsync(0);

      expect(session.editorTabs.value[0].content).toBe('new content');
      expect(session.editorTabs.value[0].isModified).toBe(false);
    });
  });

  describe('closeEditorTabInSession', () => {
    it('会话不存在时应返回 false', async () => {
      const result = await closeEditorTabInSession('nonexistent', 'tab1');
      expect(result).toBe(false);
    });

    it('标签页不存在时应返回 false', async () => {
      const session = createMockSession();
      setSession(session);

      const result = await closeEditorTabInSession('s1', 'nonexistent');
      expect(result).toBe(false);
    });

    it('关闭标签页应返回 true 并从列表中移除', async () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/test.ts', filename: 'test.ts' });
      session.editorTabs.value.push(tab);
      setSession(session);

      const result = await closeEditorTabInSession('s1', 'tab1');
      expect(result).toBe(true);
      expect(session.editorTabs.value).toHaveLength(0);
    });

    it('关闭活动标签页后应切换到相邻标签页', async () => {
      const session = createMockSession();
      const tab1 = createMockTab({ id: 'tab1', filePath: '/a.ts', filename: 'a.ts' });
      const tab2 = createMockTab({ id: 'tab2', filePath: '/b.ts', filename: 'b.ts' });
      const tab3 = createMockTab({ id: 'tab3', filePath: '/c.ts', filename: 'c.ts' });
      session.editorTabs.value.push(tab1, tab2, tab3);
      session.activeEditorTabId.value = 'tab2';
      setSession(session);

      await closeEditorTabInSession('s1', 'tab2');

      expect(session.editorTabs.value).toHaveLength(2);
      expect(session.activeEditorTabId.value).toBe('tab1');
    });

    it('关闭最后一个标签页后活动 ID 应为 null', async () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/test.ts', filename: 'test.ts' });
      session.editorTabs.value.push(tab);
      session.activeEditorTabId.value = 'tab1';
      setSession(session);

      await closeEditorTabInSession('s1', 'tab1');

      expect(session.activeEditorTabId.value).toBeNull();
    });

    it('未保存修改时应弹出确认对话框', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const showConfirmDialog = vi.fn().mockResolvedValue(false);
      const result = await closeEditorTabInSession('s1', 'tab1', { showConfirmDialog, t: mockT });

      expect(showConfirmDialog).toHaveBeenCalled();
      expect(result).toBe(false);
      expect(session.editorTabs.value).toHaveLength(1);
    });

    it('确认丢弃修改后应关闭标签页', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const showConfirmDialog = vi.fn().mockResolvedValue(true);
      const result = await closeEditorTabInSession('s1', 'tab1', { showConfirmDialog, t: mockT });

      expect(result).toBe(true);
      expect(session.editorTabs.value).toHaveLength(0);
    });
  });

  describe('setActiveEditorTabInSession', () => {
    it('会话不存在时应输出错误日志', () => {
      setActiveEditorTabInSession('nonexistent', 'tab1');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('不存在的会话 nonexistent'));
    });

    it('标签页不存在时应输出警告日志', () => {
      const session = createMockSession();
      setSession(session);

      setActiveEditorTabInSession('s1', 'nonexistent');
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('不存在的标签页 ID: nonexistent'),
      );
    });

    it('应正确切换活动标签页', () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/test.ts', filename: 'test.ts' });
      session.editorTabs.value.push(tab);
      setSession(session);

      setActiveEditorTabInSession('s1', 'tab1');
      expect(session.activeEditorTabId.value).toBe('tab1');
    });

    it('已是活动标签页时不应重复设置', () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/test.ts', filename: 'test.ts' });
      session.editorTabs.value.push(tab);
      session.activeEditorTabId.value = 'tab1';
      setSession(session);

      setActiveEditorTabInSession('s1', 'tab1');
      expect(session.activeEditorTabId.value).toBe('tab1');
    });
  });

  describe('updateFileContentInSession', () => {
    it('会话不存在时应输出错误日志', () => {
      updateFileContentInSession('nonexistent', 'tab1', 'content');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('不存在的会话 nonexistent'));
    });

    it('标签页不存在时应输出警告日志', () => {
      const session = createMockSession();
      setSession(session);

      updateFileContentInSession('s1', 'nonexistent', 'content');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的标签页'));
    });

    it('应更新内容并标记为已修改', () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        content: 'old',
        originalContent: 'old',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      updateFileContentInSession('s1', 'tab1', 'new content');
      expect(tab.content).toBe('new content');
      expect(tab.isModified).toBe(true);
    });

    it('内容与原始相同时应标记为未修改', () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        content: 'same',
        originalContent: 'same',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      updateFileContentInSession('s1', 'tab1', 'same');
      expect(tab.isModified).toBe(false);
    });

    it('正在加载的标签页不应更新内容', () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isLoading: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      updateFileContentInSession('s1', 'tab1', 'new content');
      expect(tab.content).toBe('');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('正在加载'));
    });

    it('保存状态为 success 或 error 时应重置为 idle', () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        saveStatus: 'success',
        saveError: 'old error',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      updateFileContentInSession('s1', 'tab1', 'new');
      expect(tab.saveStatus).toBe('idle');
      expect(tab.saveError).toBeNull();
    });
  });

  describe('saveFileInSession', () => {
    it('会话不存在时应输出错误日志', async () => {
      await saveFileInSession('nonexistent', 'tab1', mockDependencies());
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('不存在的会话 nonexistent'));
    });

    it('标签页不存在时应输出警告日志', async () => {
      const session = createMockSession();
      setSession(session);

      await saveFileInSession('s1', 'nonexistent', mockDependencies());
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的标签页'));
    });

    it('未修改时不应保存', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: false,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const deps = mockDependencies();
      await saveFileInSession('s1', 'tab1', deps);
      expect(deps.getOrCreateSftpManager).not.toHaveBeenCalled();
    });

    it('正在保存时不应重复保存', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
        isSaving: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      await saveFileInSession('s1', 'tab1', mockDependencies());
      expect(log.warn).toHaveBeenCalled();
    });

    it('未连接时应设置保存错误', async () => {
      const session = createMockSession();
      session.wsManager.isConnected.value = false;
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      await saveFileInSession('s1', 'tab1', mockDependencies());

      expect(tab.saveStatus).toBe('error');
      expect(tab.saveError).toBeTruthy();
    });

    it('SFTP 未就绪时应设置保存错误', async () => {
      const session = createMockSession();
      session.wsManager.isSftpReady.value = false;
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      await saveFileInSession('s1', 'tab1', mockDependencies());

      expect(tab.saveStatus).toBe('error');
    });

    it('SFTP 管理器为 null 时应设置保存错误', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue(null);

      await saveFileInSession('s1', 'tab1', deps);

      expect(tab.saveStatus).toBe('error');
    });

    it('保存成功应更新状态并清除修改标记', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        content: 'new content',
        originalContent: 'old',
        isModified: true,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue({
        writeFile: vi.fn().mockResolvedValue(undefined),
      });

      await saveFileInSession('s1', 'tab1', deps);

      expect(tab.isSaving).toBe(false);
      expect(tab.saveStatus).toBe('success');
      expect(tab.isModified).toBe(false);
      expect(tab.originalContent).toBe('new content');
    });

    it('保存失败应设置错误状态', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
        content: 'content',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue({
        writeFile: vi.fn().mockRejectedValue(new Error('写入失败')),
      });

      await saveFileInSession('s1', 'tab1', deps);

      expect(tab.isSaving).toBe(false);
      expect(tab.saveStatus).toBe('error');
      expect(tab.saveError).toContain('写入失败');
    });

    it('保存成功后超时应重置 saveStatus', async () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        isModified: true,
        content: 'content',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      const deps = mockDependencies();
      deps.getOrCreateSftpManager.mockReturnValue({
        writeFile: vi.fn().mockResolvedValue(undefined),
      });

      await saveFileInSession('s1', 'tab1', deps);
      expect(tab.saveStatus).toBe('success');

      vi.advanceTimersByTime(2000);
      expect(tab.saveStatus).toBe('idle');
    });
  });

  describe('changeEncodingInSession', () => {
    it('会话不存在时应输出警告日志', () => {
      changeEncodingInSession('nonexistent', 'tab1', 'utf-16');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的会话 nonexistent'));
    });

    it('标签页不存在时应输出警告日志', () => {
      const session = createMockSession();
      setSession(session);

      changeEncodingInSession('s1', 'nonexistent', 'utf-16');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的标签页'));
    });

    it('无原始数据时应设置错误', () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        rawContentBase64: null,
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      changeEncodingInSession('s1', 'tab1', 'utf-16');
      expect(tab.loadingError).toContain('缺少原始文件数据');
    });

    it('编码相同时不应重新解码', () => {
      const session = createMockSession();
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        selectedEncoding: 'utf-8',
        content: 'original',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      changeEncodingInSession('s1', 'tab1', 'utf-8');
      // 编码相同，内容不应改变
      expect(tab.content).toBe('original');
      expect(tab.selectedEncoding).toBe('utf-8');
    });

    it('应使用新编码重新解码文件内容', () => {
      const session = createMockSession();
      const rawBase64 = Buffer.from('test content').toString('base64');
      const tab = createMockTab({
        id: 'tab1',
        filePath: '/test.ts',
        filename: 'test.ts',
        rawContentBase64: rawBase64,
        selectedEncoding: 'ascii',
      });
      session.editorTabs.value.push(tab);
      setSession(session);

      changeEncodingInSession('s1', 'tab1', 'utf-8');

      // 验证编码已更新，内容已重新解码（通过 mock 的 decodeRawContent）
      expect(tab.selectedEncoding).toBe('utf-8');
      expect(tab.loadingError).toBeNull();
      // 内容应该被设置（decodeRawContent mock 返回 buffer 转 utf-8 的结果）
      expect(typeof tab.content).toBe('string');
    });
  });

  describe('closeOtherTabsInSession', () => {
    it('会话不存在时不应抛出异常', async () => {
      await expect(closeOtherTabsInSession('nonexistent', 'tab1')).resolves.not.toThrow();
    });

    it('目标标签页不存在时不应抛出异常', async () => {
      const session = createMockSession();
      setSession(session);

      await expect(closeOtherTabsInSession('s1', 'nonexistent')).resolves.not.toThrow();
    });

    it('应关闭除目标外的所有标签页', async () => {
      const session = createMockSession();
      const tab1 = createMockTab({ id: 'tab1', filePath: '/a.ts', filename: 'a.ts' });
      const tab2 = createMockTab({ id: 'tab2', filePath: '/b.ts', filename: 'b.ts' });
      const tab3 = createMockTab({ id: 'tab3', filePath: '/c.ts', filename: 'c.ts' });
      session.editorTabs.value.push(tab1, tab2, tab3);
      setSession(session);

      await closeOtherTabsInSession('s1', 'tab2');

      expect(session.editorTabs.value).toHaveLength(1);
      expect(session.editorTabs.value[0].id).toBe('tab2');
    });

    it('只有一个标签页时不应移除', async () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/a.ts', filename: 'a.ts' });
      session.editorTabs.value.push(tab);
      setSession(session);

      await closeOtherTabsInSession('s1', 'tab1');

      expect(session.editorTabs.value).toHaveLength(1);
    });
  });

  describe('closeTabsToTheRightInSession', () => {
    it('会话不存在时不应抛出异常', async () => {
      await expect(closeTabsToTheRightInSession('nonexistent', 'tab1')).resolves.not.toThrow();
    });

    it('目标标签页不存在时不应抛出异常', async () => {
      const session = createMockSession();
      setSession(session);

      await expect(closeTabsToTheRightInSession('s1', 'nonexistent')).resolves.not.toThrow();
    });

    it('应关闭目标右侧的所有标签页', async () => {
      const session = createMockSession();
      const tab1 = createMockTab({ id: 'tab1', filePath: '/a.ts', filename: 'a.ts' });
      const tab2 = createMockTab({ id: 'tab2', filePath: '/b.ts', filename: 'b.ts' });
      const tab3 = createMockTab({ id: 'tab3', filePath: '/c.ts', filename: 'c.ts' });
      session.editorTabs.value.push(tab1, tab2, tab3);
      setSession(session);

      await closeTabsToTheRightInSession('s1', 'tab1');

      expect(session.editorTabs.value).toHaveLength(1);
      expect(session.editorTabs.value[0].id).toBe('tab1');
    });

    it('最后一个标签页右侧无标签页时不应移除', async () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/a.ts', filename: 'a.ts' });
      session.editorTabs.value.push(tab);
      setSession(session);

      await closeTabsToTheRightInSession('s1', 'tab1');

      expect(session.editorTabs.value).toHaveLength(1);
    });
  });

  describe('closeTabsToTheLeftInSession', () => {
    it('会话不存在时不应抛出异常', async () => {
      await expect(closeTabsToTheLeftInSession('nonexistent', 'tab1')).resolves.not.toThrow();
    });

    it('目标标签页不存在时不应抛出异常', async () => {
      const session = createMockSession();
      setSession(session);

      await expect(closeTabsToTheLeftInSession('s1', 'nonexistent')).resolves.not.toThrow();
    });

    it('应关闭目标左侧的所有标签页', async () => {
      const session = createMockSession();
      const tab1 = createMockTab({ id: 'tab1', filePath: '/a.ts', filename: 'a.ts' });
      const tab2 = createMockTab({ id: 'tab2', filePath: '/b.ts', filename: 'b.ts' });
      const tab3 = createMockTab({ id: 'tab3', filePath: '/c.ts', filename: 'c.ts' });
      session.editorTabs.value.push(tab1, tab2, tab3);
      setSession(session);

      await closeTabsToTheLeftInSession('s1', 'tab3');

      expect(session.editorTabs.value).toHaveLength(1);
      expect(session.editorTabs.value[0].id).toBe('tab3');
    });

    it('第一个标签页左侧无标签页时不应移除', async () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/a.ts', filename: 'a.ts' });
      session.editorTabs.value.push(tab);
      setSession(session);

      await closeTabsToTheLeftInSession('s1', 'tab1');

      expect(session.editorTabs.value).toHaveLength(1);
    });
  });

  describe('updateTabScrollPositionInSession', () => {
    it('会话不存在时应输出错误日志', () => {
      updateTabScrollPositionInSession('nonexistent', 'tab1', 100, 50);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('不存在的会话 nonexistent'));
    });

    it('标签页不存在时应输出警告日志', () => {
      const session = createMockSession();
      setSession(session);

      updateTabScrollPositionInSession('s1', 'nonexistent', 100, 50);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的标签页'));
    });

    it('应更新标签页的滚动位置', () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/test.ts', filename: 'test.ts' });
      session.editorTabs.value.push(tab);
      setSession(session);

      updateTabScrollPositionInSession('s1', 'tab1', 200, 100);

      expect(tab.scrollTop).toBe(200);
      expect(tab.scrollLeft).toBe(100);
    });

    it('多次调用应覆盖之前的滚动位置', () => {
      const session = createMockSession();
      const tab = createMockTab({ id: 'tab1', filePath: '/test.ts', filename: 'test.ts' });
      session.editorTabs.value.push(tab);
      setSession(session);

      updateTabScrollPositionInSession('s1', 'tab1', 100, 50);
      updateTabScrollPositionInSession('s1', 'tab1', 300, 150);

      expect(tab.scrollTop).toBe(300);
      expect(tab.scrollLeft).toBe(150);
    });
  });
});
