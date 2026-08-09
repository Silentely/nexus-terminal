/**
 * composables/useEditorEvents 单元测试
 * 覆盖编辑器标签事件在共享/独立两种模式下的分流逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, shallowRef, type Ref } from 'vue';
import { useEditorEvents, type EditorEventsDependencies } from './useEditorEvents';

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// 测试用宽松标签类型（真实 FileTab 字段多，mock 仅需 id 字段）
interface FileTab {
  id: string;
  [key: string]: unknown;
}

function createDeps(overrides?: Partial<EditorEventsDependencies>): {
  deps: EditorEventsDependencies;
  fileEditorStore: EditorEventsDependencies['fileEditorStore'];
  sessionStore: EditorEventsDependencies['sessionStore'];
  shareFileEditorTabsBoolean: Ref<boolean>;
  activeSessionId: Ref<string | null>;
  activeSession: Ref<{
    sessionId: string;
    editorTabs: Ref<FileTab[]>;
    activeEditorTabId: Ref<string | null>;
  } | null>;
} {
  const fileEditorStore = {
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    updateFileContent: vi.fn(),
    saveFile: vi.fn(),
    changeEncoding: vi.fn(),
    changeLineEnding: vi.fn(),
    updateTabScrollPosition: vi.fn(),
    orderedTabs: ref<FileTab[]>([]),
    activeTabId: ref<string | null>(null),
  } as unknown as EditorEventsDependencies['fileEditorStore'];
  const sessionStore = {
    closeEditorTabInSession: vi.fn(),
    setActiveEditorTabInSession: vi.fn(),
    updateFileContentInSession: vi.fn(),
    saveFileInSession: vi.fn(),
    changeEncodingInSession: vi.fn(),
    changeLineEndingInSession: vi.fn(),
    updateTabScrollPositionInSession: vi.fn(),
  } as unknown as EditorEventsDependencies['sessionStore'];
  const activeSessionId = ref<string | null>('session-1');
  // 用 shallowRef 保留嵌套 Ref 语义（真实场景中 activeSession 是 storeToRefs 对象，
  // 其 editorTabs 属性本身是 Ref；深度响应式 ref 会解包嵌套 ref 导致 .value 失效）
  const activeSession = shallowRef<{
    sessionId: string;
    editorTabs: Ref<FileTab[]>;
    activeEditorTabId: Ref<string | null>;
  } | null>({
    sessionId: 'session-1',
    editorTabs: ref<FileTab[]>([{ id: 'tab-1' }, { id: 'tab-2' }]),
    activeEditorTabId: ref<string | null>('tab-1'),
  });

  const shareFileEditorTabsBoolean = ref(false);

  const deps = {
    fileEditorStore,
    sessionStore,
    activeSessionId,
    activeSession,
    shareFileEditorTabsBoolean,
    ...overrides,
  } as unknown as EditorEventsDependencies;
  return {
    deps,
    fileEditorStore,
    sessionStore,
    shareFileEditorTabsBoolean,
    activeSessionId,
    activeSession,
  };
}

describe('useEditorEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('editorTabs / activeEditorTabId 计算属性', () => {
    it('共享模式下返回 fileEditorStore 的标签', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;
      fileEditorStore.orderedTabs.value = [
        { id: 'shared-1' },
      ] as unknown as EditorEventsDependencies['fileEditorStore']['orderedTabs']['value'];

      const { editorTabs } = useEditorEvents(deps);
      expect(editorTabs.value.map((t) => t.id)).toEqual(['shared-1']);
    });

    it('独立模式下返回活动会话的标签', () => {
      const { deps, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = false;

      const { editorTabs } = useEditorEvents(deps);
      expect(editorTabs.value.map((t) => t.id)).toEqual(['tab-1', 'tab-2']);
    });

    it('独立模式且无活动会话时返回空数组', () => {
      const { deps, activeSession, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = false;
      activeSession.value = null;

      const { editorTabs } = useEditorEvents(deps);
      expect(editorTabs.value).toEqual([]);
    });
  });

  describe('handleCloseEditorTab', () => {
    it('共享模式调用 fileEditorStore.closeTab', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;

      useEditorEvents(deps).handleCloseEditorTab('tab-1');
      expect(fileEditorStore.closeTab).toHaveBeenCalledWith('tab-1');
    });

    it('独立模式调用 sessionStore.closeEditorTabInSession', () => {
      const { deps, sessionStore, shareFileEditorTabsBoolean, activeSessionId } = createDeps();
      shareFileEditorTabsBoolean.value = false;
      activeSessionId.value = 'session-2';

      useEditorEvents(deps).handleCloseEditorTab('tab-1');
      expect(sessionStore.closeEditorTabInSession).toHaveBeenCalledWith('session-2', 'tab-1');
    });

    it('独立模式无活动会话时不调用 store 并告警', () => {
      const { deps, sessionStore, shareFileEditorTabsBoolean, activeSessionId } = createDeps();
      shareFileEditorTabsBoolean.value = false;
      activeSessionId.value = null;

      useEditorEvents(deps).handleCloseEditorTab('tab-1');
      expect(sessionStore.closeEditorTabInSession).not.toHaveBeenCalled();
    });
  });

  describe('handleActivateEditorTab', () => {
    it('共享模式调用 fileEditorStore.setActiveTab', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;

      useEditorEvents(deps).handleActivateEditorTab('tab-2');
      expect(fileEditorStore.setActiveTab).toHaveBeenCalledWith('tab-2');
    });

    it('独立模式调用 sessionStore.setActiveEditorTabInSession', () => {
      const { deps, sessionStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = false;

      useEditorEvents(deps).handleActivateEditorTab('tab-2');
      expect(sessionStore.setActiveEditorTabInSession).toHaveBeenCalledWith('session-1', 'tab-2');
    });
  });

  describe('handleUpdateEditorContent', () => {
    it('共享模式调用 fileEditorStore.updateFileContent', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;

      useEditorEvents(deps).handleUpdateEditorContent({ tabId: 'tab-1', content: 'hello' });
      expect(fileEditorStore.updateFileContent).toHaveBeenCalledWith('tab-1', 'hello');
    });

    it('独立模式调用 sessionStore.updateFileContentInSession', () => {
      const { deps, sessionStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = false;

      useEditorEvents(deps).handleUpdateEditorContent({ tabId: 'tab-1', content: 'world' });
      expect(sessionStore.updateFileContentInSession).toHaveBeenCalledWith(
        'session-1',
        'tab-1',
        'world',
      );
    });
  });

  describe('handleSaveEditorTab', () => {
    it('共享模式调用 fileEditorStore.saveFile', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;

      useEditorEvents(deps).handleSaveEditorTab('tab-1');
      expect(fileEditorStore.saveFile).toHaveBeenCalledWith('tab-1');
    });

    it('独立模式调用 sessionStore.saveFileInSession', () => {
      const { deps, sessionStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = false;

      useEditorEvents(deps).handleSaveEditorTab('tab-1');
      expect(sessionStore.saveFileInSession).toHaveBeenCalledWith('session-1', 'tab-1');
    });
  });

  describe('handleChangeEncoding', () => {
    it('共享模式调用 fileEditorStore.changeEncoding', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;

      useEditorEvents(deps).handleChangeEncoding({ tabId: 'tab-1', encoding: 'utf-8' });
      expect(fileEditorStore.changeEncoding).toHaveBeenCalledWith('tab-1', 'utf-8');
    });

    it('独立模式调用 sessionStore.changeEncodingInSession', () => {
      const { deps, sessionStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = false;

      useEditorEvents(deps).handleChangeEncoding({ tabId: 'tab-1', encoding: 'gbk' });
      expect(sessionStore.changeEncodingInSession).toHaveBeenCalledWith(
        'session-1',
        'tab-1',
        'gbk',
      );
    });
  });

  describe('handleChangeLineEnding', () => {
    it('共享模式调用 fileEditorStore.changeLineEnding', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;

      useEditorEvents(deps).handleChangeLineEnding({ tabId: 'tab-1', lineEnding: 'crlf' });
      expect(fileEditorStore.changeLineEnding).toHaveBeenCalledWith('tab-1', 'crlf');
    });
  });

  describe('handleEditorScrollPositionUpdate', () => {
    it('共享模式调用 fileEditorStore.updateTabScrollPosition', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;

      useEditorEvents(deps).handleEditorScrollPositionUpdate({
        tabId: 'tab-1',
        scrollTop: 100,
        scrollLeft: 50,
      });
      expect(fileEditorStore.updateTabScrollPosition).toHaveBeenCalledWith('tab-1', 100, 50);
    });
  });

  describe('批量关闭标签', () => {
    it('handleCloseOtherEditorTabs 应关闭除目标外的所有标签', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;
      fileEditorStore.orderedTabs.value = [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ] as unknown as EditorEventsDependencies['fileEditorStore']['orderedTabs']['value'];

      const { handleCloseOtherEditorTabs } = useEditorEvents(deps);
      handleCloseOtherEditorTabs('b');
      expect(fileEditorStore.closeTab).toHaveBeenCalledWith('a');
      expect(fileEditorStore.closeTab).toHaveBeenCalledWith('c');
      expect(fileEditorStore.closeTab).not.toHaveBeenCalledWith('b');
    });

    it('handleCloseEditorTabsToRight 应关闭目标右侧标签', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;
      fileEditorStore.orderedTabs.value = [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ] as unknown as EditorEventsDependencies['fileEditorStore']['orderedTabs']['value'];

      const { handleCloseEditorTabsToRight } = useEditorEvents(deps);
      handleCloseEditorTabsToRight('a');
      expect(fileEditorStore.closeTab).toHaveBeenCalledWith('b');
      expect(fileEditorStore.closeTab).toHaveBeenCalledWith('c');
      expect(fileEditorStore.closeTab).not.toHaveBeenCalledWith('a');
    });

    it('handleCloseEditorTabsToLeft 应关闭目标左侧标签', () => {
      const { deps, fileEditorStore, shareFileEditorTabsBoolean } = createDeps();
      shareFileEditorTabsBoolean.value = true;
      fileEditorStore.orderedTabs.value = [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ] as unknown as EditorEventsDependencies['fileEditorStore']['orderedTabs']['value'];

      const { handleCloseEditorTabsToLeft } = useEditorEvents(deps);
      handleCloseEditorTabsToLeft('c');
      expect(fileEditorStore.closeTab).toHaveBeenCalledWith('a');
      expect(fileEditorStore.closeTab).toHaveBeenCalledWith('b');
      expect(fileEditorStore.closeTab).not.toHaveBeenCalledWith('c');
    });
  });
});
