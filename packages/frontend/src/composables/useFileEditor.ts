import { ref, readonly, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
// 移除对 useSftpActions 的直接导入，因为方法是注入的
// import { useSftpActions } from './useSftpActions';
// 从类型文件导入所需类型
import type { EditorFileContent, SaveStatus } from '../types/sftp.types';

// --- 类型定义 (已移至 sftp.types.ts) ---
// export type SaveStatus = 'idle' | 'saving' | 'success' | 'error';
// export interface EditorFileContent { ... }

// 辅助函数：根据文件名获取语言 (从 FileManager.vue 迁移)
const getLanguageFromFilename = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'py':
      return 'python';
    case 'java':
      return 'java';
    case 'c':
      return 'c';
    case 'cpp':
      return 'cpp';
    case 'cs':
      return 'csharp';
    case 'go':
      return 'go';
    case 'php':
      return 'php';
    case 'rb':
      return 'ruby';
    case 'rs':
      return 'rust';
    case 'sql':
      return 'sql';
    case 'sh':
      return 'shell';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'md':
      return 'markdown';
    case 'xml':
      return 'xml';
    case 'ini':
      return 'ini';
    case 'bat':
      return 'bat';
    case 'dockerfile':
      return 'dockerfile';
    default:
      return 'plaintext';
  }
};

export function useFileEditor(
  // 注入依赖：需要 SFTP 操作模块提供的读写文件方法
  sftpReadFile: (path: string) => Promise<EditorFileContent>,
  sftpWriteFile: (path: string, content: string) => Promise<void>
) {
  const { t } = useI18n();

  // --- 编辑器状态 ---
  const isEditorVisible = ref(false);
  const editingFilePath = ref<string | null>(null);
  const editingFileContent = ref<string>(''); // 用于 v-model 绑定
  const editingFileLanguage = ref<string>('plaintext');
  const editingFileEncoding = ref<'utf8' | 'base64'>('utf8'); // 文件内容的原始编码
  const isEditorLoading = ref<boolean>(false);
  const editorError = ref<string | null>(null);
  const isSaving = ref<boolean>(false);
  const saveStatus = ref<SaveStatus>('idle');
  const saveError = ref<string | null>(null);

  // --- 方法 ---

  const openFile = async (filePath: string) => {
    console.log(`[文件编辑器模块] 尝试打开文件: ${filePath}`);
    if (!filePath) return;

    // 如果已经是同一个文件，则不重新加载（除非需要强制刷新）
    // if (editingFilePath.value === filePath && isEditorVisible.value) {
    //     console.log(`[文件编辑器模块] 文件 ${filePath} 已在编辑器中打开。`);
    //     return;
    // }

    isEditorVisible.value = true; // 显示编辑器区域
    isEditorLoading.value = true; // 显示加载状态
    editorError.value = null;
    saveStatus.value = 'idle'; // 重置保存状态
    saveError.value = null;
    editingFilePath.value = filePath;
    editingFileLanguage.value = getLanguageFromFilename(filePath);
    editingFileContent.value = ''; // 清空旧内容

    try {
      const fileData = await sftpReadFile(filePath); // 调用注入的 readFile 方法
      console.log(`[文件编辑器模块] 文件 ${filePath} 读取成功。编码: ${fileData.encoding}`);

      // 处理可能的 Base64 编码
      if (fileData.encoding === 'base64') {
        try {
          editingFileContent.value = atob(fileData.content); // 解码
          editingFileEncoding.value = 'base64'; // 记录原始编码
        } catch (decodeError) {
          console.error(`[文件编辑器模块] Base64 解码错误 for ${filePath}:`, decodeError);
          editorError.value = t('fileManager.errors.fileDecodeError');
          editingFileContent.value = `// ${t('fileManager.errors.fileDecodeError')}\n${fileData.content}`; // 显示原始 Base64 作为后备
        }
      } else {
        editingFileContent.value = fileData.content;
        editingFileEncoding.value = 'utf8';
      }
      isEditorLoading.value = false;
    } catch (err: any) {
      console.error(`[文件编辑器模块] 读取文件 ${filePath} 失败:`, err);
      editorError.value = `${t('fileManager.errors.readFileFailed')}: ${err.message || err}`;
      editingFileContent.value = `// ${editorError.value}`; // 在编辑器中显示错误
      isEditorLoading.value = false;
    }
  };

  const saveFile = async () => {
    if (!editingFilePath.value || isSaving.value || isEditorLoading.value || editorError.value) {
      console.warn('[文件编辑器模块] 保存条件不满足，无法保存。', {
        path: editingFilePath.value,
        isSaving: isSaving.value,
        isLoading: isEditorLoading.value,
        hasError: !!editorError.value,
      });
      return;
    }

    console.log(`[文件编辑器模块] 开始保存文件: ${editingFilePath.value}`);
    isSaving.value = true;
    saveStatus.value = 'saving';
    saveError.value = null;

    const contentToSave = editingFileContent.value; // 获取当前编辑器内容

    try {
      await sftpWriteFile(editingFilePath.value, contentToSave); // 调用注入的 writeFile 方法
      console.log(`[文件编辑器模块] 文件 ${editingFilePath.value} 保存成功。`);
      isSaving.value = false;
      saveStatus.value = 'success';
      saveError.value = null;

      // 成功提示短暂显示后消失
      setTimeout(() => {
        if (saveStatus.value === 'success') {
          saveStatus.value = 'idle';
        }
      }, 2000);
    } catch (err: any) {
      console.error(`[文件编辑器模块] 保存文件 ${editingFilePath.value} 失败:`, err);
      isSaving.value = false;
      saveStatus.value = 'error';
      saveError.value = `${t('fileManager.errors.saveFailed')}: ${err.message || err}`;

      // 错误提示显示时间长一些
      setTimeout(() => {
        if (saveStatus.value === 'error') {
          saveStatus.value = 'idle';
          saveError.value = null;
        }
      }, 5000);
    }
  };

  const closeEditor = () => {
    console.log('[文件编辑器模块] 关闭编辑器。');
    isEditorVisible.value = false;
    editingFilePath.value = null;
    editingFileContent.value = '';
    editorError.value = null;
    isEditorLoading.value = false;
    saveStatus.value = 'idle';
    saveError.value = null;
    isSaving.value = false;
  };

  // 提供一个方法来更新内容，主要用于 v-model
  const updateContent = (newContent: string) => {
    editingFileContent.value = newContent;
    // 当用户编辑时，可以重置保存状态（如果需要）
    if (saveStatus.value === 'success' || saveStatus.value === 'error') {
      saveStatus.value = 'idle';
      saveError.value = null;
    }
  };

  // 注意：这个 composable 不直接处理 WebSocket 消息，
  // 它依赖注入的 sftpReadFile 和 sftpWriteFile 函数，
  // 这些函数（在 useSftpActions 中实现）内部处理了相应的 WebSocket 消息和请求/响应逻辑。

  return {
    // 状态 (只读的 ref)
    isEditorVisible: readonly(isEditorVisible),
    editingFilePath: readonly(editingFilePath),
    editingFileLanguage: readonly(editingFileLanguage),
    isEditorLoading: readonly(isEditorLoading),
    editorError: readonly(editorError),
    isSaving: readonly(isSaving),
    saveStatus: readonly(saveStatus),
    saveError: readonly(saveError),

    // 可写状态 (用于 v-model)
    editingFileContent, // 直接暴露 ref 用于 v-model

    // 方法
    openFile,
    saveFile,
    closeEditor,
    updateContent, // 如果需要从外部更新内容
  };
}
