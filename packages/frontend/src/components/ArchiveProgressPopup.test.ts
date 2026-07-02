/**
 * ArchiveProgressPopup.vue 单元测试
 * 测试压缩/解压进度弹窗的渲染逻辑
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ArchiveProgressPopup from './ArchiveProgressPopup.vue';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
  }),
}));

/** 创建默认的进度状态 */
function makeProgress(overrides: Record<string, unknown> = {}) {
  return {
    active: false,
    operation: null,
    fileCount: 0,
    currentFile: null,
    archiveName: null,
    ...overrides,
  };
}

describe('ArchiveProgressPopup', () => {
  it('非活跃状态不应渲染弹窗', () => {
    const wrapper = mount(ArchiveProgressPopup, {
      props: { progress: makeProgress({ active: false }) },
    });

    expect(wrapper.find('.fixed').exists()).toBe(false);
  });

  it('活跃压缩状态应显示操作名称和归档名', () => {
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'compress',
          archiveName: 'data.tar.gz',
        }),
      },
    });

    expect(wrapper.find('.fixed').exists()).toBe(true);
    expect(wrapper.text()).toContain('fileManager.contextMenu.compress');
    expect(wrapper.text()).toContain('data.tar.gz');
  });

  it('活跃解压状态应显示解压操作名称', () => {
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'decompress',
          archiveName: 'backup.zip',
        }),
      },
    });

    expect(wrapper.text()).toContain('fileManager.contextMenu.decompress');
    expect(wrapper.text()).toContain('backup.zip');
  });

  it('应显示已处理文件数', () => {
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'compress',
          fileCount: 42,
          archiveName: 'test.zip',
        }),
      },
    });

    expect(wrapper.text()).toContain('fileManager.archiveProgress.filesProcessed');
  });

  it('应显示当前正在处理的文件名', () => {
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'compress',
          fileCount: 5,
          currentFile: 'src/index.ts',
          archiveName: 'test.zip',
        }),
      },
    });

    expect(wrapper.text()).toContain('src/index.ts');
  });

  it('fileCount 为 0 且无 currentFile 时应显示 starting 提示', () => {
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'compress',
          fileCount: 0,
          currentFile: null,
          archiveName: 'test.zip',
        }),
      },
    });

    expect(wrapper.text()).toContain('fileManager.archiveProgress.starting');
  });

  it('文件名超过 40 字符时应截断并保留开头', () => {
    const longName = '/very/long/path/to/some/deeply/nested/directory/file.txt';
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'compress',
          fileCount: 1,
          currentFile: longName,
          archiveName: 'test.zip',
        }),
      },
    });

    // 应截断为前 37 字符 + "..."
    const displayed = wrapper.find('.truncate').text();
    expect(displayed).toBe(longName.slice(0, 37) + '...');
    expect(displayed.length).toBe(40);
  });

  it('文件名不超过 40 字符时不应截断', () => {
    const shortName = 'src/index.ts';
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'compress',
          fileCount: 1,
          currentFile: shortName,
          archiveName: 'test.zip',
        }),
      },
    });

    expect(wrapper.find('.truncate').text()).toBe(shortName);
  });

  it('归档名为空时应显示省略号占位', () => {
    const wrapper = mount(ArchiveProgressPopup, {
      props: {
        progress: makeProgress({
          active: true,
          operation: 'compress',
          archiveName: null,
        }),
      },
    });

    expect(wrapper.text()).toContain('...');
  });
});
