/**
 * useFileEditor Composable 单元测试
 * 测试文件编辑器的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { useFileEditor } from './useFileEditor';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('useFileEditor', () => {
  let mockSftpReadFile: ReturnType<typeof vi.fn>;
  let mockSftpWriteFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // 创建 mock 函数
    mockSftpReadFile = vi.fn();
    mockSftpWriteFile = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // 辅助函数：创建 useFileEditor 实例
  function createFileEditor() {
    return useFileEditor(mockSftpReadFile, mockSftpWriteFile);
  }

  describe('初始状态', () => {
    it('应返回正确的初始状态', () => {
      const editor = createFileEditor();

      expect(editor.isEditorVisible.value).toBe(false);
      expect(editor.editingFilePath.value).toBeNull();
      expect(editor.editingFileContent.value).toBe('');
      expect(editor.editingFileLanguage.value).toBe('plaintext');
      expect(editor.isEditorLoading.value).toBe(false);
      expect(editor.editorError.value).toBeNull();
      expect(editor.isSaving.value).toBe(false);
      expect(editor.saveStatus.value).toBe('idle');
      expect(editor.saveError.value).toBeNull();
    });

    it('应暴露所需的方法', () => {
      const editor = createFileEditor();

      expect(typeof editor.openFile).toBe('function');
      expect(typeof editor.saveFile).toBe('function');
      expect(typeof editor.closeEditor).toBe('function');
      expect(typeof editor.updateContent).toBe('function');
    });
  });

  describe('openFile', () => {
    it('空路径不应执行任何操作', async () => {
      const editor = createFileEditor();

      await editor.openFile('');

      expect(mockSftpReadFile).not.toHaveBeenCalled();
      expect(editor.isEditorVisible.value).toBe(false);
    });

    it('应成功打开 UTF-8 文件', async () => {
      const testContent = 'console.log("Hello World");';
      mockSftpReadFile.mockResolvedValue({
        content: testContent,
        encoding: 'utf8',
      });

      const editor = createFileEditor();
      const openPromise = editor.openFile('/home/user/test.js');

      // 打开时应显示加载状态
      expect(editor.isEditorVisible.value).toBe(true);
      expect(editor.isEditorLoading.value).toBe(true);
      expect(editor.editingFilePath.value).toBe('/home/user/test.js');
      expect(editor.editingFileLanguage.value).toBe('javascript');

      await openPromise;

      expect(mockSftpReadFile).toHaveBeenCalledWith('/home/user/test.js');
      expect(editor.editingFileContent.value).toBe(testContent);
      expect(editor.isEditorLoading.value).toBe(false);
      expect(editor.editorError.value).toBeNull();
    });

    it('应成功打开 Base64 编码文件', async () => {
      // 使用 ASCII 字符避免 btoa 编码问题
      const originalContent = 'Hello, World!';
      const base64Content = btoa(originalContent);
      mockSftpReadFile.mockResolvedValue({
        content: base64Content,
        encoding: 'base64',
      });

      const editor = createFileEditor();
      await editor.openFile('/home/user/file.txt');

      expect(editor.editingFileContent.value).toBe(originalContent);
      expect(editor.isEditorLoading.value).toBe(false);
    });

    it('Base64 解码失败应显示错误', async () => {
      mockSftpReadFile.mockResolvedValue({
        content: '!!!invalid-base64!!!',
        encoding: 'base64',
      });

      const editor = createFileEditor();
      await editor.openFile('/home/user/file.txt');

      expect(editor.editorError.value).toBe('fileManager.errors.fileDecodeError');
      // 应显示原始 Base64 作为后备
      expect(editor.editingFileContent.value).toContain('!!!invalid-base64!!!');
    });

    it('读取文件失败应显示错误', async () => {
      mockSftpReadFile.mockRejectedValue(new Error('Permission denied'));

      const editor = createFileEditor();
      await editor.openFile('/home/user/secret.txt');

      expect(editor.isEditorLoading.value).toBe(false);
      expect(editor.editorError.value).toContain('fileManager.errors.readFileFailed');
      expect(editor.editorError.value).toContain('Permission denied');
    });

    it('打开新文件应重置保存状态', async () => {
      mockSftpReadFile.mockResolvedValue({
        content: 'test',
        encoding: 'utf8',
      });
      mockSftpWriteFile.mockResolvedValue(undefined);

      const editor = createFileEditor();

      // 先打开文件并保存，使状态变为 success
      await editor.openFile('/home/user/old.txt');
      await editor.saveFile();
      expect(editor.saveStatus.value).toBe('success');

      // 打开新文件应重置保存状态
      await editor.openFile('/home/user/new.txt');

      expect(editor.saveStatus.value).toBe('idle');
    });
  });

  describe('saveFile', () => {
    it('无文件路径不应保存', async () => {
      const editor = createFileEditor();

      await editor.saveFile();

      expect(mockSftpWriteFile).not.toHaveBeenCalled();
    });

    it('正在保存时不应重复保存', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'test', encoding: 'utf8' });
      mockSftpWriteFile.mockImplementation(() => new Promise(() => {})); // 永不 resolve

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');

      editor.saveFile(); // 开始保存
      await nextTick();
      expect(editor.isSaving.value).toBe(true);

      await editor.saveFile(); // 尝试再次保存

      expect(mockSftpWriteFile).toHaveBeenCalledTimes(1);
    });

    it('加载中不应保存', async () => {
      const editor = createFileEditor();
      mockSftpReadFile.mockImplementation(() => new Promise(() => {})); // 永不 resolve

      editor.openFile('/home/user/test.txt'); // 开始加载但不等待完成

      await editor.saveFile();

      expect(mockSftpWriteFile).not.toHaveBeenCalled();
    });

    it('有编辑器错误时不应保存', async () => {
      mockSftpReadFile.mockRejectedValue(new Error('Read error'));

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');

      expect(editor.editorError.value).not.toBeNull();

      await editor.saveFile();

      expect(mockSftpWriteFile).not.toHaveBeenCalled();
    });

    it('应成功保存文件', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'original', encoding: 'utf8' });
      mockSftpWriteFile.mockResolvedValue(undefined);

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');

      editor.updateContent('modified content');
      await editor.saveFile();

      expect(mockSftpWriteFile).toHaveBeenCalledWith('/home/user/test.txt', 'modified content');
      expect(editor.saveStatus.value).toBe('success');
      expect(editor.isSaving.value).toBe(false);
      expect(editor.saveError.value).toBeNull();
    });

    it('保存成功后应在 2 秒后重置状态', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'test', encoding: 'utf8' });
      mockSftpWriteFile.mockResolvedValue(undefined);

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');
      await editor.saveFile();

      expect(editor.saveStatus.value).toBe('success');

      vi.advanceTimersByTime(2000);

      expect(editor.saveStatus.value).toBe('idle');
    });

    it('保存失败应显示错误', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'test', encoding: 'utf8' });
      mockSftpWriteFile.mockRejectedValue(new Error('Disk full'));

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');
      await editor.saveFile();

      expect(editor.saveStatus.value).toBe('error');
      expect(editor.saveError.value).toContain('fileManager.errors.saveFailed');
      expect(editor.saveError.value).toContain('Disk full');
      expect(editor.isSaving.value).toBe(false);
    });

    it('保存错误应在 5 秒后重置', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'test', encoding: 'utf8' });
      mockSftpWriteFile.mockRejectedValue(new Error('Error'));

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');
      await editor.saveFile();

      expect(editor.saveStatus.value).toBe('error');

      vi.advanceTimersByTime(5000);

      expect(editor.saveStatus.value).toBe('idle');
      expect(editor.saveError.value).toBeNull();
    });
  });

  describe('closeEditor', () => {
    it('应重置所有编辑器状态', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'test', encoding: 'utf8' });

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');

      expect(editor.isEditorVisible.value).toBe(true);

      editor.closeEditor();

      expect(editor.isEditorVisible.value).toBe(false);
      expect(editor.editingFilePath.value).toBeNull();
      expect(editor.editingFileContent.value).toBe('');
      expect(editor.editorError.value).toBeNull();
      expect(editor.isEditorLoading.value).toBe(false);
      expect(editor.saveStatus.value).toBe('idle');
      expect(editor.saveError.value).toBeNull();
      expect(editor.isSaving.value).toBe(false);
    });
  });

  describe('updateContent', () => {
    it('应更新编辑器内容', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'original', encoding: 'utf8' });

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');

      editor.updateContent('new content');

      expect(editor.editingFileContent.value).toBe('new content');
    });

    it('更新内容应重置 success 状态', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'test', encoding: 'utf8' });
      mockSftpWriteFile.mockResolvedValue(undefined);

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');
      await editor.saveFile();

      expect(editor.saveStatus.value).toBe('success');

      editor.updateContent('modified');

      expect(editor.saveStatus.value).toBe('idle');
      expect(editor.saveError.value).toBeNull();
    });

    it('更新内容应重置 error 状态', async () => {
      mockSftpReadFile.mockResolvedValue({ content: 'test', encoding: 'utf8' });
      mockSftpWriteFile.mockRejectedValue(new Error('Error'));

      const editor = createFileEditor();
      await editor.openFile('/home/user/test.txt');
      await editor.saveFile();

      expect(editor.saveStatus.value).toBe('error');

      editor.updateContent('modified');

      expect(editor.saveStatus.value).toBe('idle');
      expect(editor.saveError.value).toBeNull();
    });
  });

  describe('语言检测', () => {
    const languageTestCases = [
      { ext: 'js', expected: 'javascript' },
      { ext: 'ts', expected: 'typescript' },
      { ext: 'json', expected: 'json' },
      { ext: 'html', expected: 'html' },
      { ext: 'css', expected: 'css' },
      { ext: 'scss', expected: 'scss' },
      { ext: 'less', expected: 'less' },
      { ext: 'py', expected: 'python' },
      { ext: 'java', expected: 'java' },
      { ext: 'c', expected: 'c' },
      { ext: 'cpp', expected: 'cpp' },
      { ext: 'cs', expected: 'csharp' },
      { ext: 'go', expected: 'go' },
      { ext: 'php', expected: 'php' },
      { ext: 'rb', expected: 'ruby' },
      { ext: 'rs', expected: 'rust' },
      { ext: 'sql', expected: 'sql' },
      { ext: 'sh', expected: 'shell' },
      { ext: 'yaml', expected: 'yaml' },
      { ext: 'yml', expected: 'yaml' },
      { ext: 'md', expected: 'markdown' },
      { ext: 'xml', expected: 'xml' },
      { ext: 'ini', expected: 'ini' },
      { ext: 'bat', expected: 'bat' },
      { ext: 'dockerfile', expected: 'dockerfile' },
      { ext: 'unknown', expected: 'plaintext' },
      { ext: '', expected: 'plaintext' },
    ];

    languageTestCases.forEach(({ ext, expected }) => {
      it(`应为 .${ext} 文件检测语言为 ${expected}`, async () => {
        mockSftpReadFile.mockResolvedValue({ content: '', encoding: 'utf8' });

        const editor = createFileEditor();
        const filename = ext ? `test.${ext}` : 'test';
        await editor.openFile(`/home/user/${filename}`);

        expect(editor.editingFileLanguage.value).toBe(expected);
      });
    });
  });
});
