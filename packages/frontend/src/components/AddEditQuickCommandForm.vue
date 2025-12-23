<template>
  <div class="fixed inset-0 bg-overlay flex justify-center items-center z-50">
    <div
      ref="modalContentRef"
      class="bg-background text-foreground p-6 rounded-xl border border-border/50 shadow-2xl flex flex-col"
      :style="{
        width: resizableWidth ? `${resizableWidth}px` : undefined,
        height: resizableHeight ? `${resizableHeight}px` : undefined,
      }"
    >
      <h2 class="m-0 mb-6 text-center text-xl font-semibold">
        {{
          isEditing
            ? t('quickCommands.form.titleEdit', '编辑快捷指令')
            : t('quickCommands.form.titleAdd', '添加快捷指令')
        }}
      </h2>
      <div class="flex-grow flex space-x-6 min-h-0">
        <!-- 左侧：变量管理 -->
        <div class="w-1/3 border-r border-border/30 pr-6 flex flex-col overflow-y-auto">
          <h3 class="text-md font-medium mb-3 text-text-secondary">
            {{ t('quickCommands.form.variablesTitle', '变量管理') }}
          </h3>
          <div class="space-y-3 overflow-y-auto flex-grow pr-1 pb-2">
            <div
              v-if="localVariables.length === 0"
              class="text-sm text-text-tertiary p-2 border border-dashed border-border/30 rounded-md"
            >
              {{ t('quickCommands.form.noVariables', '暂无变量。点击下方按钮添加。') }}
            </div>
            <div
              v-for="(variable, index) in localVariables"
              :key="variable.id"
              class="p-2.5 border border-border/40 rounded-lg bg-input/30 space-y-2"
            >
              <input
                type="text"
                v-model="variable.name"
                :placeholder="t('quickCommands.form.variableNamePlaceholder', '变量名')"
                class="w-full px-3 py-1.5 border border-border/50 rounded-md bg-input text-foreground text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary"
              />
              <textarea
                v-model="variable.value"
                :placeholder="t('quickCommands.form.variableValuePlaceholder', '变量值')"
                rows="2"
                class="w-full px-3 py-1.5 border border-border/50 rounded-md bg-input text-foreground text-xs resize-y min-h-[40px] shadow-sm focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary"
              ></textarea>
              <button
                type="button"
                @click="deleteVariable(variable.id)"
                class="w-full py-1 px-3 text-xs text-error hover:bg-error/10 border border-error/50 rounded-md transition-colors duration-150"
              >
                {{ t('common.delete', '删除') }}
              </button>
            </div>
          </div>
          <button
            type="button"
            @click="addVariable"
            class="mt-3 w-full py-2 px-4 border border-primary/50 text-primary text-sm rounded-md hover:bg-primary/10 transition-colors duration-150"
          >
            {{ t('quickCommands.form.addVariable', '+ 添加变量') }}
          </button>
        </div>

        <!-- 右侧：现有表单 -->
        <form @submit.prevent="handleSubmit" class="w-2/3 space-y-5 flex flex-col">
          <div class="flex-grow space-y-5 pr-1 flex flex-col">
            <div>
              <label for="qc-name" class="block mb-1.5 text-sm font-medium text-text-secondary">{{
                t('quickCommands.form.name', '名称:')
              }}</label>
              <input
                id="qc-name"
                type="text"
                v-model="formData.name"
                :placeholder="t('quickCommands.form.namePlaceholder', '可选，用于快速识别')"
                class="w-full px-4 py-2 border border-border/50 rounded-lg bg-input text-foreground text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out"
              />
            </div>
            <div class="flex flex-col flex-grow">
              <label for="qc-command" class="block mb-1.5 text-sm font-medium text-text-secondary"
                >{{ t('quickCommands.form.command', '指令:') }}
                <span class="text-error">*</span></label
              >
              <textarea
                id="qc-command"
                v-model="formData.command"
                required
                :placeholder="placeholder"
                class="w-full px-4 py-2 border border-border/50 rounded-lg bg-input text-foreground text-sm min-h-[80px] shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out whitespace-nowrap overflow-x-auto flex-grow"
              ></textarea>
              <small v-if="commandError" class="text-error text-xs mt-1 block">{{
                commandError
              }}</small>
            </div>
            <!-- +++ 标签输入区 +++ -->
            <div>
              <label for="qc-tags" class="block mb-1.5 text-sm font-medium text-text-secondary">{{
                t('quickCommands.form.tags', '标签:')
              }}</label>
              <TagInput
                id="qc-tags"
                v-model="formData.tagIds"
                :available-tags="quickCommandTagsStore.tags"
                :placeholder="t('quickCommands.form.tagsPlaceholder', '添加或选择标签...')"
                @create-tag="handleCreateTag"
                :allow-create="true"
                :allow-delete="true"
                @delete-tag="handleDeleteTag"
                class="w-full"
              />
              <!-- 根据需要为 TagInput 添加样式/类 -->
            </div>
          </div>
          <!-- +++ 标签输入区结束 +++ -->
          <div class="flex justify-end mt-auto pt-4 border-t border-border/50">
            <!-- 次要/取消按钮 -->
            <button
              type="button"
              @click="closeForm"
              class="py-2 px-5 rounded-lg text-sm font-medium transition-colors duration-150 bg-background border border-border/50 text-text-secondary hover:bg-border hover:text-foreground mr-3"
            >
              {{ t('common.cancel', '取消') }}
            </button>
            <!-- 执行按钮 -->
            <button
              type="button"
              @click="handleExecute"
              class="py-2 px-5 rounded-lg text-sm font-semibold transition-colors duration-150 bg-[var(--color-success)] text-white border-none shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-success)] mr-3"
            >
              {{ t('quickCommands.form.execute', '执行') }}
            </button>
            <!-- 主要/提交按钮 -->
            <button
              type="submit"
              :disabled="isSubmitting || !!commandError"
              class="py-2 px-5 rounded-lg text-sm font-semibold transition-colors duration-150 bg-primary text-white border-none shadow-md hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:bg-gray-400 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {{
                isSubmitting
                  ? t('common.saving', '保存中...')
                  : isEditing
                    ? t('common.save', '保存')
                    : t('quickCommands.form.add', '添加')
              }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useResizable } from '../composables/useResizable';
import { useI18n } from 'vue-i18n';
import { useQuickCommandsStore, type QuickCommandFE } from '../stores/quickCommands.store';
import { useQuickCommandTagsStore } from '../stores/quickCommandTags.store';
import { useSessionStore } from '../stores/session.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents';
import TagInput from './TagInput.vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { useAlertDialog } from '../composables/useAlertDialog';

const props = defineProps<{
  commandToEdit?: QuickCommandFE | null; // 接收要编辑的指令对象 (应包含标签ID和变量)
}>();

const emit = defineEmits(['close']);

const { t } = useI18n();
const { showConfirmDialog } = useConfirmDialog();
const { showAlertDialog } = useAlertDialog();
const quickCommandsStore = useQuickCommandsStore();
const quickCommandTagsStore = useQuickCommandTagsStore();
const sessionStore = useSessionStore();
const uiNotificationsStore = useUiNotificationsStore();
const emitWorkspaceEvent = useWorkspaceEventEmitter();
const isSubmitting = ref(false);

const modalContentRef = ref<HTMLElement | null>(null);
const R_MIN_WIDTH = 800; // 可调整大小的最小宽度 (像素)
const R_MIN_HEIGHT = 700; // 可调整大小的最小高度 (像素)
const placeholder = t('quickCommands.form.commandPlaceholder') + 'echo "Hello,\${USERNAME}"';

const { width: resizableWidth, height: resizableHeight } = useResizable(modalContentRef, {
  minWidth: R_MIN_WIDTH,
  minHeight: R_MIN_HEIGHT,
  // 如果需要，可以在此处添加最大宽度和最大高度，例如：window.innerWidth * 0.95
});

const isEditing = computed(() => !!props.commandToEdit);

const formData = reactive({
  name: '',
  command: '',
  tagIds: [] as number[], // +++ 添加标签ID +++
});
const localVariables = ref<{ name: string; value: string; id: string }[]>([]);

const commandError = ref<string | null>(null);

// 监听指令内容变化，进行校验
watch(
  () => formData.command,
  (newCommand) => {
    if (!newCommand || newCommand.trim().length === 0) {
      commandError.value = t('quickCommands.form.errorCommandRequired', '指令内容不能为空');
    } else {
      commandError.value = null;
    }
  }
);

// 初始化表单数据 (如果是编辑模式)
onMounted(() => {
  if (typeof window !== 'undefined') {
    let initialW = Math.min(window.innerWidth * 0.9, 1152); // 目标 90vw，最大 1152px
    let initialH = window.innerHeight * 0.85; // 目标 85vh

    initialW = Math.max(R_MIN_WIDTH, initialW);
    initialH = Math.max(R_MIN_HEIGHT, initialH);

    resizableWidth.value = initialW;
    resizableHeight.value = initialH;
  }

  if (isEditing.value && props.commandToEdit) {
    formData.name = props.commandToEdit.name ?? '';
    formData.command = props.commandToEdit.command;
    formData.tagIds = props.commandToEdit.tagIds ? [...props.commandToEdit.tagIds] : [];
    if (props.commandToEdit.variables) {
      localVariables.value = Object.entries(props.commandToEdit.variables).map(([name, value]) => ({
        name,
        value,
        id: `var-${Date.now()}-${Math.random().toString(36).substring(7)}`, // 生成唯一ID
      }));
    } else {
      localVariables.value = [];
    }
  }
});

const handleCreateTag = async (tagName: string) => {
  console.log(`[QuickCmdForm] Received create-tag event for: ${tagName}`);
  if (!tagName || tagName.trim().length === 0) return;
  console.log(`[QuickCmdForm] Calling quickCommandTagsStore.addTag...`);
  const newTag = await quickCommandTagsStore.addTag(tagName.trim());
  if (newTag && !formData.tagIds.includes(newTag.id)) {
    console.log(`[QuickCmdForm] New tag created (ID: ${newTag.id}), adding to selection.`);
    formData.tagIds.push(newTag.id);
  }
};

const handleDeleteTag = async (tagId: number) => {
  console.log(`[QuickCmdForm] Received delete-tag event for ID: ${tagId}`);
  const tagToDelete = quickCommandTagsStore.tags.find((t) => t.id === tagId);
  if (!tagToDelete) return;

  const confirmed = await showConfirmDialog({
    message: t('tags.prompts.confirmDelete', { name: tagToDelete.name }),
  });
  if (confirmed) {
    console.log(`[QuickCmdForm] Calling quickCommandTagsStore.deleteTag...`);
    const success = await quickCommandTagsStore.deleteTag(tagId);
    if (success) {
      // 如果删除成功，TagInput的availableTags将会更新，
      // 并且标签应该从输入框中消失。
      // 如果该标签已被选中，我们还需要从本地的formData.tagIds中移除它。
      const index = formData.tagIds.indexOf(tagId);
      if (index > -1) {
        console.log(`[QuickCmdForm] Removing deleted tag ID ${tagId} from selection.`);
        formData.tagIds.splice(index, 1);
      }
    } else {
      showAlertDialog({
        title: t('common.error', '错误'),
        message: t('tags.errorDelete', { error: quickCommandTagsStore.error || '未知错误' }),
      });
    }
  }
};

const handleSubmit = async () => {
  if (commandError.value) return; // 如果校验失败则不提交

  isSubmitting.value = true;
  let success = false;

  // 处理名称，空字符串视为 null
  const finalName = formData.name.trim().length > 0 ? formData.name.trim() : null;

  const variablesToSave: Record<string, string> = localVariables.value.reduce(
    (acc, curr) => {
      if (curr.name.trim()) {
        // 只保存带有名称的变量
        acc[curr.name.trim()] = curr.value;
      }
      return acc;
    },
    {} as Record<string, string>
  );

  if (isEditing.value && props.commandToEdit) {
    success = await quickCommandsStore.updateQuickCommand(
      props.commandToEdit.id,
      finalName,
      formData.command.trim(),
      formData.tagIds,
      variablesToSave
    );
  } else {
    success = await quickCommandsStore.addQuickCommand(
      finalName,
      formData.command.trim(),
      formData.tagIds,
      variablesToSave
    );
  }

  isSubmitting.value = false;
  if (success) {
    closeForm();
  }
};

const closeForm = () => {
  emit('close');
};

//向 localVariables 数组添加一个新变量
const addVariable = () => {
  localVariables.value.push({
    name: '',
    value: '',
    id: `var-${Date.now()}-${Math.random().toString(36).substring(7)}`, // 生成唯一ID
  });
};

// 通过 ID 从 localVariables 数组中删除变量
const deleteVariable = (variableId: string) => {
  localVariables.value = localVariables.value.filter((v) => v.id !== variableId);
};

// 使用当前变量执行命令
const handleExecute = () => {
  let processedCommand = formData.command;
  const currentVariables = localVariables.value.reduce(
    (acc, curr) => {
      if (curr.name.trim()) {
        acc[curr.name.trim()] = curr.value;
      }
      return acc;
    },
    {} as Record<string, string>
  );

  // 执行变量替换
  for (const varName in currentVariables) {
    const placeholder = new RegExp(`\\$\\{${varName}\\}`, 'g');
    processedCommand = processedCommand.replace(placeholder, currentVariables[varName]);
  }

  // 检查模板中是否存在未定义的变量
  const variablePlaceholders = formData.command.match(/\$\{[^\}]+\}/g) || [];
  const undefinedVariables: string[] = [];
  variablePlaceholders.forEach((placeholder) => {
    const varName = placeholder.substring(2, placeholder.length - 1);
    if (!currentVariables.hasOwnProperty(varName)) {
      undefinedVariables.push(varName);
    }
  });

  if (undefinedVariables.length > 0) {
    uiNotificationsStore.showWarning(
      t('quickCommands.form.warningUndefinedVariables', {
        variables: undefinedVariables.join(', '),
      })
    );
  }

  const activeSessionId = sessionStore.activeSessionId;
  if (!activeSessionId) {
    uiNotificationsStore.showError(
      t('quickCommands.form.errorNoActiveSession', '没有活动的SSH会话可执行指令。')
    );
    return;
  }

  console.log(
    `[QuickCmdForm] Executing processed command: "${processedCommand}" on session ${activeSessionId}`
  );
  emitWorkspaceEvent('quickCommand:executeProcessed', {
    command: processedCommand,
    sessionId: activeSessionId,
  });

  closeForm();
};
</script>
