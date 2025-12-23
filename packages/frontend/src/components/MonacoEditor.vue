<template>
  <div ref="editorContainer" class="monaco-editor-container"></div>
</template>

<script setup lang="ts">
import {
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  defineExpose,
  defineProps,
  defineEmits,
} from 'vue';
import * as monaco from 'monaco-editor';

const FONT_SIZE_STORAGE_KEY = 'monacoEditorFontSize'; // localStorage key

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'plaintext',
  },
  theme: {
    type: String,
    default: 'vs-dark',
  },
  readOnly: {
    type: Boolean,
    default: false,
  },
  fontFamily: {
    type: String,
    default: 'Consolas, "Courier New", monospace',
  },
  fontSize: {
    type: Number,
    default: 14, // 默认字体大小
  },
  initialScrollTop: {
    type: Number,
    default: 0,
  },
  initialScrollLeft: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits([
  'update:modelValue',
  'request-save',
  'update:scrollPosition',
  'update:fontSize',
]); // 添加 'update:fontSize'

const editorContainer = ref<HTMLElement | null>(null);
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
let wheelEventHandler: ((event: WheelEvent) => void) | null = null; // 保存 wheel 事件处理器引用

// 用于驱动编辑器实例的 ref，并与 localStorage 和 props.fontSize 同步
const internalEditorFontSize = ref(props.fontSize);

onMounted(() => {
  // 优先使用 props.fontSize 初始化 internalEditorFontSize
  internalEditorFontSize.value = props.fontSize;

  // 检查 localStorage 中是否有用户通过滚轮操作留下的偏好
  const storedUserPreference = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  if (storedUserPreference) {
    const parsedSize = parseInt(storedUserPreference, 10);
    if (!isNaN(parsedSize) && parsedSize >= 8 && parsedSize <= 40) {
      // 如果 localStorage 的值与当前的 internalEditorFontSize (来自 prop) 不同，
      // 表明用户可能通过滚轮调整过，此时以 localStorage 为准，并通知更新全局状态
      if (parsedSize !== internalEditorFontSize.value) {
        emit('update:fontSize', parsedSize);
      }
      internalEditorFontSize.value = parsedSize;
    }
  }

  if (editorContainer.value) {
    editorInstance = monaco.editor.create(editorContainer.value, {
      value: props.modelValue,
      language: props.language,
      theme: props.theme,
      fontSize: internalEditorFontSize.value, // 使用 internalEditorFontSize
      fontFamily: props.fontFamily, // 使用 prop 的字体家族
      automaticLayout: true,
      readOnly: props.readOnly,
      minimap: { enabled: true },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
    });

    editorInstance.onDidChangeModelContent(() => {
      if (editorInstance) {
        const currentValue = editorInstance.getValue();
        if (currentValue !== props.modelValue) {
          emit('update:modelValue', currentValue);
        }
      }
    });

    // Ctrl+S / Cmd+S
    editorInstance.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      precondition: undefined,
      keybindingContext: undefined,
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: () => {
        console.log('[MonacoEditor] Save action triggered (Ctrl+S / Cmd+S)');
        emit('request-save');
      },
    });

    // 应用初始滚动位置
    if (props.initialScrollTop > 0 || props.initialScrollLeft > 0) {
      editorInstance.setScrollPosition({
        scrollTop: props.initialScrollTop,
        scrollLeft: props.initialScrollLeft,
      });
    }

    // 监听滚动事件
    editorInstance.onDidScrollChange((e) => {
      if (editorInstance) {
        // 只有当滚动是由用户操作或实际视口变化引起时才发出
        // setScrollPosition 也会触发此事件，需要避免循环
        // 一个简单的检查是，如果事件中的滚动值与 props 中的初始值不同，则认为是有效滚动
        // 但更好的方式是父组件在设置初始值后才开始监听此事件，或此组件内部处理
        // 为简单起见，我们直接 emit
        emit('update:scrollPosition', {
          scrollTop: editorInstance.getScrollTop(),
          scrollLeft: editorInstance.getScrollLeft(),
        });
      }
    });

    editorInstance.onDidChangeModelContent(() => {
      if (editorInstance) {
        const currentValue = editorInstance.getValue();
        if (currentValue !== props.modelValue) {
          emit('update:modelValue', currentValue);
        }
      }
    });

    //Ctrl+S / Cmd+S
    editorInstance.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      precondition: undefined,
      keybindingContext: undefined,
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: () => {
        console.log('[MonacoEditor] Save action triggered (Ctrl+S / Cmd+S)');
        emit('request-save');
      },
    });

    // --- 添加带防抖的鼠标滚轮缩放功能 ---
    const editorDomNode = editorInstance?.getDomNode();
    if (editorDomNode && editorInstance) {
      // console.log('[MonacoEditor] Adding wheel event listener.');
      // 定义事件处理器并保存引用，以便在组件销毁时正确移除
      wheelEventHandler = (event: WheelEvent) => {
        if (event.ctrlKey && editorInstance) {
          event.preventDefault();
          const currentSizeOpt = editorInstance.getOption(monaco.editor.EditorOption.fontSize);
          const currentSize =
            typeof currentSizeOpt === 'number' ? currentSizeOpt : internalEditorFontSize.value;

          let newSize: number;
          if (event.deltaY < 0) {
            newSize = Math.min(currentSize + 1, 40); // 字体上限 40
          } else {
            newSize = Math.max(currentSize - 1, 8); // 字体下限 8
          }

          if (newSize !== currentSize) {
            // console.log(`[MonacoEditor] Updating font size to: ${newSize}`);
            editorInstance.updateOptions({ fontSize: newSize });
            localStorage.setItem(FONT_SIZE_STORAGE_KEY, newSize.toString());
            internalEditorFontSize.value = newSize; // 更新 internal ref
            emit('update:fontSize', newSize); // 发出事件以更新 store
          }
        }
      };
      editorDomNode.addEventListener('wheel', wheelEventHandler, { passive: false });
    } else {
      // console.error('[MonacoEditor] editorDomNode or editorInstance is null, cannot add wheel listener.');
    }

    // --- 移除鼠标滚轮缩放功能 ---
    // const editorDomNode = editorInstance?.getDomNode();
    // if (editorDomNode) {
    //   editorDomNode.addEventListener('wheel', (event: WheelEvent) => {
    //     if (event.ctrlKey) {
    //       event.preventDefault();
    //       // ... (移除字体大小调整逻辑) ...
    //       // if (editorInstance) {
    //       //   editorInstance.updateOptions({ fontSize: fontSize.value }); // 使用本地 fontSize
    //       // }
    //     }
    //   }, { passive: false });
    // }
  }
});

watch(
  () => props.modelValue,
  (newValue) => {
    if (editorInstance && editorInstance.getValue() !== newValue) {
      editorInstance.setValue(newValue);
    }
  }
);

watch(
  () => props.language,
  (newLanguage) => {
    if (editorInstance && editorInstance.getModel()) {
      monaco.editor.setModelLanguage(editorInstance.getModel()!, newLanguage);
    }
  }
);

watch(
  () => props.theme,
  (newTheme) => {
    if (editorInstance) {
      monaco.editor.setTheme(newTheme);
    }
  }
);

watch(
  () => props.readOnly,
  (newReadOnly) => {
    if (editorInstance) {
      editorInstance.updateOptions({ readOnly: newReadOnly });
    }
  }
);

watch(
  () => props.fontFamily,
  (newFontFamily) => {
    if (editorInstance) {
      editorInstance.updateOptions({ fontFamily: newFontFamily });
    }
  }
);

// 监听来自父组件 (全局设置) 的 fontSize 变化
watch(
  () => props.fontSize,
  (newGlobalSize) => {
    // 只有当全局设置的 fontSize (通过 prop) 改变时，并且与 internalEditorFontSize (编辑器当前实际或本地调整后) 不同时才更新
    if (editorInstance && newGlobalSize !== internalEditorFontSize.value) {
      // console.log(`[MonacoEditor] Global font size changed to: ${newGlobalSize}, updating editor.`);
      editorInstance.updateOptions({ fontSize: newGlobalSize });
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, newGlobalSize.toString()); // 保持 localStorage 同步
      internalEditorFontSize.value = newGlobalSize;
    }
  }
);

onBeforeUnmount(() => {
  // 移除 wheel 事件监听器，防止内存泄漏
  if (wheelEventHandler && editorInstance) {
    const editorDomNode = editorInstance.getDomNode();
    if (editorDomNode) {
      editorDomNode.removeEventListener('wheel', wheelEventHandler);
      wheelEventHandler = null;
    }
  }

  // 释放编辑器实例
  if (editorInstance) {
    editorInstance.dispose();
    editorInstance = null;
  }
});

defineExpose({
  focus: () => editorInstance?.focus(),
});
</script>

<style scoped>
.monaco-editor-container {
  width: 100%;
  height: 100%;
  min-height: 300px;
  text-align: left;
}
</style>
