<script setup lang="ts">
import { ref, computed, watch, reactive, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import draggable from 'vuedraggable';
import {
  useFocusSwitcherStore,
  type FocusableInput,
  type FocusItemConfig,
  type FocusSwitcherFullConfig,
} from '../stores/focusSwitcher.store';
import { storeToRefs } from 'pinia';
import { useConfirmDialog } from '../composables/useConfirmDialog';

// 本地接口，仅用于右侧列表显示
interface SequenceDisplayItem extends FocusableInput {}

// --- Props ---
const props = defineProps({
  isVisible: {
    type: Boolean,
    required: true,
  },
});

// --- Emits ---
const emit = defineEmits(['close']);

// --- Setup ---
const { t } = useI18n();
const focusSwitcherStore = useFocusSwitcherStore(); // 实例化 Store
const { showConfirmDialog } = useConfirmDialog();

// --- State ---
const dialogRef = ref<HTMLElement | null>(null);
const initialDialogState = { width: 900, height: 600 }; // *** 增加初始尺寸 ***
const dialogStyle = reactive({
  width: `${initialDialogState.width}px`,
  height: `${initialDialogState.height}px`,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  position: 'absolute' as 'absolute',
});
const hasChanges = ref(false);
// 本地副本，用于在弹窗内编辑
const localSequence = ref<SequenceDisplayItem[]>([]); // 右侧列表，只关心顺序和基础信息
const localItemConfigs = ref<Record<string, FocusItemConfig>>({}); // 所有项目的配置 (快捷键)
const originalConfig = ref<FocusSwitcherFullConfig | null>(null); // 存储原始完整配置用于比较

// --- Watchers ---
watch(
  () => props.isVisible,
  async (newValue) => {
    // ++ Make async for potential backend load ++
    if (newValue) {
      // --- 加载完整配置 ---
      // 确保 Store 已初始化 (如果 Store 还没有加载完)
      // await focusSwitcherStore.loadConfigurationFromBackend(); // 如果 Store 初始化时未加载，则在此加载

      const currentSequenceOrder = focusSwitcherStore.sequenceOrder;
      const currentItemConfigs = focusSwitcherStore.itemConfigs;
      const allAvailableInputs = focusSwitcherStore.availableInputs; // 获取所有可用输入的基础信息
      const inputsMap = new Map(allAvailableInputs.map((input) => [input.id, input]));

      console.log('[FocusSwitcherConfigurator] Loading full config from store...');
      console.log(
        '[FocusSwitcherConfigurator] Store sequenceOrder:',
        JSON.stringify(currentSequenceOrder)
      );
      console.log(
        '[FocusSwitcherConfigurator] Store itemConfigs:',
        JSON.stringify(currentItemConfigs)
      );

      // 构建本地右侧列表 (localSequence)
      localSequence.value = currentSequenceOrder
        .map((id) => inputsMap.get(id)) // 获取基础信息
        .filter((input): input is SequenceDisplayItem => input !== undefined); // 过滤掉无效 ID 并断言类型

      // 构建本地所有项目配置 (localItemConfigs) - 深拷贝
      // 确保所有 availableInputs 都有一个条目，即使没有快捷键
      const initialConfigs: Record<string, FocusItemConfig> = {};
      allAvailableInputs.forEach((input) => {
        initialConfigs[input.id] = { ...(currentItemConfigs[input.id] || {}) }; // 复制 store 中的配置，或创建空对象
      });
      localItemConfigs.value = JSON.parse(JSON.stringify(initialConfigs));

      // 存储原始完整配置用于比较
      originalConfig.value = JSON.parse(
        JSON.stringify({
          sequence: currentSequenceOrder,
          shortcuts: currentItemConfigs,
        })
      );

      hasChanges.value = false;
      console.log(
        '[FocusSwitcherConfigurator] Dialog opened. Loaded localSequence:',
        JSON.stringify(localSequence.value)
      );
      console.log(
        '[FocusSwitcherConfigurator] Loaded localItemConfigs:',
        JSON.stringify(localItemConfigs.value)
      );
      console.log(
        '[FocusSwitcherConfigurator] Original full config stored:',
        JSON.stringify(originalConfig.value)
      );
      // 重置/计算初始位置和大小
      requestAnimationFrame(() => {
        if (dialogRef.value) {
          const initialWidth = initialDialogState.width;
          const initialHeight = initialDialogState.height;
          dialogStyle.width = `${initialWidth}px`;
          dialogStyle.height = `${initialHeight}px`;
          dialogStyle.left = `${(window.innerWidth - initialWidth) / 2}px`;
          dialogStyle.top = `${(window.innerHeight - initialHeight) / 2}px`;
          dialogStyle.transform = 'none';
          dialogStyle.position = 'absolute';
        }
      });
    } else {
      // 清理工作（如果需要）
    }
  }
);

// 监听本地序列（包括快捷键）变化，标记未保存更改
// --- 修改：监听 localSequence 和 localItemConfigs 的变化 ---
watch(
  [localSequence, localItemConfigs],
  () => {
    if (!originalConfig.value) return; // Not initialized yet

    // 1. Construct the current configuration based on local state
    const currentFullConfig: FocusSwitcherFullConfig = {
      sequence: localSequence.value.map((item) => item.id),
      shortcuts: {},
    };
    // Populate shortcuts, only including those with a defined and non-empty string value
    focusSwitcherStore.availableInputs.forEach((input) => {
      const localConfig = localItemConfigs.value[input.id];
      // Only include if shortcut is defined, is a string, and is not empty
      if (
        localConfig?.shortcut &&
        typeof localConfig.shortcut === 'string' &&
        localConfig.shortcut.trim() !== ''
      ) {
        currentFullConfig.shortcuts[input.id] = { shortcut: localConfig.shortcut };
      }
    });

    // 2. Construct a comparable version of the original config
    // Ensure original shortcuts only contain defined and non-empty string values for fair comparison
    const comparableOriginalConfig: FocusSwitcherFullConfig = {
      sequence: originalConfig.value.sequence,
      shortcuts: {},
    };
    for (const id in originalConfig.value.shortcuts) {
      const originalShortcut = originalConfig.value.shortcuts[id]?.shortcut;
      // Only include if shortcut was defined, is a string, and is not empty
      if (
        originalShortcut &&
        typeof originalShortcut === 'string' &&
        originalShortcut.trim() !== ''
      ) {
        comparableOriginalConfig.shortcuts[id] = { shortcut: originalShortcut };
      }
    }

    // 3. Compare the stringified versions
    const changed = JSON.stringify(currentFullConfig) !== JSON.stringify(comparableOriginalConfig);

    hasChanges.value = changed;
    // console.log(`[FocusSwitcherConfigurator] Comparing:`);
    // console.log("Current:", JSON.stringify(currentFullConfig));
    // console.log("Original:", JSON.stringify(comparableOriginalConfig));
    // console.log(`[FocusSwitcherConfigurator] Changes detected: ${changed}`);
  },
  { deep: true }
);

// --- Methods ---
const closeDialog = async () => {
  if (hasChanges.value) {
    const confirmed = await showConfirmDialog({
      message: t('focusSwitcher.confirmClose', '有未保存的更改，确定要关闭吗？'),
    });
    if (confirmed) {
      emit('close');
    }
  } else {
    emit('close');
  }
};

const saveConfiguration = () => {
  // 构造 FocusSwitcherFullConfig 对象
  const newSequence = localSequence.value.map((item) => item.id);
  // 清理 shortcuts，移除没有快捷键的条目 (可选，取决于后端是否需要)
  const newShortcuts: Record<string, FocusItemConfig> = {};
  for (const id in localItemConfigs.value) {
    if (localItemConfigs.value[id]?.shortcut) {
      newShortcuts[id] = { shortcut: localItemConfigs.value[id].shortcut };
    }
    // 如果需要保存空快捷键的记录，则取消 if 条件
    // newShortcuts[id] = { shortcut: localItemConfigs.value[id]?.shortcut };
  }

  const fullConfigToSave: FocusSwitcherFullConfig = {
    sequence: newSequence,
    shortcuts: newShortcuts,
  };

  console.log(
    '[FocusSwitcherConfigurator] Saving full configuration:',
    JSON.stringify(fullConfigToSave)
  );
  focusSwitcherStore.updateConfiguration(fullConfigToSave); // 调用 Store 更新函数
  console.log('[FocusSwitcherConfigurator] Configuration save process triggered.');
  hasChanges.value = false;
  emit('close'); // 保存后关闭
};

const removeFromSequence = (index: number) => {
  if (index >= 0 && index < localSequence.value.length) {
    localSequence.value.splice(index, 1);
    // hasChanges 会在 watch 中自动更新
  }
};

// --- Computed ---
// ++ 修改：计算属性，获取不在右侧序列中的项目 (用于左侧列表) ++
const localAvailableInputs = computed(() => {
  const sequenceIds = new Set(localSequence.value.map((item) => item.id));
  // 从所有可用输入中过滤掉已在序列中的，并合并本地快捷键配置
  return focusSwitcherStore.availableInputs
    .filter((input) => !sequenceIds.has(input.id))
    .map((input) => ({
      ...input,
      // shortcut: localItemConfigs.value[input.id]?.shortcut // 快捷键在下方单独配置
    }));
});

// 注意：已配置的列表直接使用 localSequence ref
// 原先的 availableInputsForConfigurator getter 在 store 中仍然存在，但我们现在使用本地计算的版本以实现实时更新
</script>

<template>
  <div
    v-if="isVisible"
    class="fixed inset-0 bg-overlay flex justify-center items-start z-[1000] pointer-events-none"
    @click.self="closeDialog"
  >
    <div
      ref="dialogRef"
      class="bg-dialog text-dialog-text rounded-lg shadow-xl flex flex-col overflow-hidden absolute pointer-events-auto cursor-default"
      :style="dialogStyle"
    >
      <header class="flex justify-between items-center p-4 border-b border-border bg-header">
        <h2 class="text-lg font-semibold">
          {{ t('focusSwitcher.configTitle', '配置 Alt 焦点切换') }}
        </h2>
        <button
          class="bg-transparent border-none text-2xl cursor-pointer text-text-secondary hover:text-foreground leading-none p-0"
          @click="closeDialog"
          :title="t('common.close', '关闭')"
        >
          &times;
        </button>
      </header>

      <div class="flex-grow p-6 flex flex-col gap-6 bg-background overflow-y-auto">
        <!-- Alt Switch Hint -->
        <p class="text-sm text-text-secondary italic mb-4">
          {{
            t('focusSwitcher.altSwitchHint', '提示：按下 Alt 键可在配置的输入源之间快速切换焦点。')
          }}
        </p>
        <!-- Top Row: Available & Configured -->
        <div class="flex gap-6 flex-shrink-0 min-h-[300px]">
          <!-- Available Inputs -->
          <section
            class="flex-1 p-4 border border-border rounded bg-input flex flex-col overflow-y-auto"
          >
            <h3
              class="mt-0 mb-4 text-base font-semibold text-text-secondary border-b border-border-light pb-2"
            >
              {{ t('focusSwitcher.availableInputs', '可用输入框') }}
            </h3>
            <draggable
              :list="localAvailableInputs"
              tag="ul"
              class="list-none p-0 m-0 min-h-[100px] border border-dashed border-border-light rounded p-2 bg-background-alt/50 flex-grow overflow-y-auto"
              item-key="id"
              :group="{ name: 'focus-inputs', pull: true, put: false }"
              :sort="false"
            >
              <template #item="{ element }: { element: FocusableInput & FocusItemConfig }">
                <li
                  class="flex items-center justify-between p-2 mb-2 bg-background border border-border rounded cursor-grab transition-colors duration-150 hover:bg-header active:cursor-grabbing active:bg-border overflow-hidden"
                >
                  <div class="flex items-center overflow-hidden">
                    <i
                      class="fas fa-grip-vertical mr-2 text-text-secondary cursor-grab active:cursor-grabbing flex-shrink-0"
                    ></i>
                    <span
                      class="flex-grow overflow-hidden text-ellipsis whitespace-nowrap mr-2 text-sm"
                      >{{ element.label }}</span
                    >
                  </div>
                </li>
              </template>
              <template #footer>
                <li
                  v-if="localAvailableInputs.length === 0"
                  class="text-center text-text-secondary italic p-4 border-none bg-transparent cursor-default text-sm"
                >
                  <span>{{ t('focusSwitcher.allInputsConfigured', '所有输入框都已配置') }}</span>
                </li>
              </template>
            </draggable>
          </section>

          <!-- Configured Sequence -->
          <section
            class="flex-1 p-4 border border-border rounded bg-input flex flex-col overflow-y-auto"
          >
            <h3
              class="mt-0 mb-4 text-base font-semibold text-text-secondary border-b border-border-light pb-2"
            >
              {{ t('focusSwitcher.configuredSequence', '切换顺序 (拖拽排序)') }}
            </h3>
            <draggable
              :list="localSequence"
              tag="ul"
              class="list-none p-0 m-0 min-h-[100px] border border-dashed border-border-light rounded p-2 bg-background-alt/50 flex-grow overflow-y-auto"
              item-key="id"
              :group="{ name: 'focus-inputs', put: true }"
              handle=".drag-handle"
            >
              <template #item="{ element, index }: { element: SequenceDisplayItem; index: number }">
                <li
                  class="flex items-center justify-between p-2 mb-2 bg-background border border-border rounded cursor-grab transition-colors duration-150 hover:bg-header active:cursor-grabbing active:bg-border overflow-hidden"
                >
                  <div class="flex items-center overflow-hidden">
                    <i
                      class="fas fa-grip-vertical drag-handle mr-2 text-text-secondary cursor-grab active:cursor-grabbing flex-shrink-0"
                    ></i>
                    <span
                      class="item-label flex-grow overflow-hidden text-ellipsis whitespace-nowrap mr-2 text-sm"
                      >{{ element.label }}</span
                    >
                  </div>
                  <button
                    class="remove-button bg-transparent border-none text-text-secondary text-lg cursor-pointer p-1 leading-none flex-shrink-0 ml-auto hover:text-error"
                    @click="removeFromSequence(index)"
                    :title="t('common.remove', '移除')"
                  >
                    &times;
                  </button>
                </li>
              </template>
              <template #footer>
                <li
                  v-if="localSequence.length === 0"
                  class="text-center text-text-secondary italic p-4 border-none bg-transparent cursor-default text-sm"
                >
                  {{ t('focusSwitcher.dragHere', '从左侧拖拽输入框到此处') }}
                </li>
              </template>
            </draggable>
          </section>
        </div>

        <!-- Shortcut Configuration -->
        <section
          class="p-4 border border-border rounded bg-input flex flex-col overflow-y-auto max-h-64 flex-shrink-0"
        >
          <h3
            class="mt-0 mb-4 text-base font-semibold text-text-secondary border-b border-border-light pb-2"
          >
            {{ t('focusSwitcher.shortcutSettings', '快捷键设置') }}
          </h3>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            <div
              v-for="input in focusSwitcherStore.availableInputs"
              :key="input.id"
              class="flex items-center justify-between bg-input p-2 rounded border border-border/50"
            >
              <span
                class="item-label flex-grow mr-3 overflow-hidden text-ellipsis whitespace-nowrap text-sm"
                >{{ input.label }}</span
              >
              <input
                type="text"
                v-model="localItemConfigs[input.id].shortcut"
                class="shortcut-input w-24 px-2 py-1 border border-border rounded bg-background text-foreground text-xs text-center flex-shrink-0 placeholder-text-alt italic"
                :placeholder="t('focusSwitcher.shortcutPlaceholder', '例如 Alt+K')"
                @keydown.prevent="captureShortcut($event, localItemConfigs[input.id])"
              />
            </div>
            <div
              v-if="
                !focusSwitcherStore.availableInputs ||
                focusSwitcherStore.availableInputs.length === 0
              "
              class="text-center text-text-secondary italic p-4 border-none bg-transparent cursor-default text-sm col-span-full"
            >
              {{ t('focusSwitcher.noInputsAvailable', '没有可配置的输入项') }}
            </div>
          </div>
        </section>
      </div>

      <footer class="p-4 border-t border-border flex justify-end gap-3 bg-header">
        <button
          @click="closeDialog"
          class="py-2 px-4 rounded text-sm transition-colors duration-150 bg-button text-button-text hover:bg-button-hover border border-border"
        >
          {{ t('common.cancel', '取消') }}
        </button>
        <button
          @click="saveConfiguration"
          class="py-2 px-4 rounded text-sm transition-colors duration-150 bg-primary text-white hover:bg-primary-dark disabled:bg-gray-400 disabled:opacity-70 disabled:cursor-not-allowed"
          :disabled="!hasChanges"
        >
          {{ t('common.save', '保存') }} {{ hasChanges ? '*' : '' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script lang="ts">
// +++ 在 <script setup> 之外定义辅助函数（如果需要更复杂的逻辑或重用）+++
// 或者直接在 setup 内部定义 captureShortcut

// ++ 修改：captureShortcut 现在接收 FocusItemConfig 并更新它 ++
const captureShortcut = (event: KeyboardEvent, itemConfig: FocusItemConfig) => {
  if (
    event.key === 'Alt' ||
    event.key === 'Control' ||
    event.key === 'Shift' ||
    event.key === 'Meta'
  ) {
    // 忽略单独的修饰键按下
    return;
  }

  if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
    // 必须是 Alt + 非修饰键
    let key = event.key;
    if (key.length === 1) {
      // 将小写字母转为大写
      key = key.toUpperCase();
    }
    // 可以添加更多验证，例如只允许字母、数字等
    if (/^[a-zA-Z0-9]$/.test(key)) {
      // 简化：只允许单个字母或数字
      itemConfig.shortcut = `Alt+${key}`; // 直接修改传入的配置对象
    } else if (key === 'Backspace' || key === 'Delete') {
      itemConfig.shortcut = undefined; // 使用 undefined 清空
    } else {
      // 可选：提示不支持的键
      console.warn(`[FocusSwitcherConfigurator] Unsupported key for shortcut: ${key}`);
    }
  } else if (event.key === 'Backspace' || event.key === 'Delete') {
    // 允许单独按 Backspace 或 Delete 清空 (即使没有 Alt)
    itemConfig.shortcut = undefined; // 使用 undefined 清空
  } else {
    // 可选：如果按下非 Alt 组合键，可以清空或提示
    // console.log('[FocusSwitcherConfigurator] Invalid shortcut combination.');
  }
};
</script>
