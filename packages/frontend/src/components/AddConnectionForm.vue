<script setup lang="ts">
import { ref, Teleport, nextTick, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ConnectionInfo } from '../stores/connections.store'; // Keep ConnectionInfo type
import { useAddConnectionForm } from '../composables/useAddConnectionForm';
import AddConnectionFormBasicInfo from './AddConnectionFormBasicInfo.vue';
import AddConnectionFormAuth from './AddConnectionFormAuth.vue';
import AddConnectionFormAdvanced from './AddConnectionFormAdvanced.vue';

// 定义组件发出的事件
const emit = defineEmits(['close', 'connection-added', 'connection-updated', 'connection-deleted']);

// 定义 Props
const props = defineProps<{
  connectionToEdit: ConnectionInfo | null;
}>();

import { getTranslation } from '../utils/languageUtils';

const { t, locale } = useI18n();
const scriptModeFormatInfo = ref(
  getTranslation('connections.form.scriptModeFormatInfo', locale.value)
);

const {
  formData,
  isLoading,
  testStatus,
  testResult,
  testLatency,
  isScriptModeActive,
  scriptInputText,
  isEditMode,
  formTitle,
  submitButtonText,
  proxies,
  tags,
  connections,
  isProxyLoading,
  proxyStoreError,
  isTagLoading,
  tagStoreError,
  advancedConnectionMode,
  addJumpHost,
  removeJumpHost,
  handleSubmit,
  handleDeleteConnection,
  handleTestConnection,
  handleCreateTag,
  handleDeleteTag,
  latencyColor,
  testButtonText,
} = useAddConnectionForm(props, emit);

const handleAdvancedConnectionModeUpdate = (newMode: 'proxy' | 'jump') => {
  advancedConnectionMode.value = newMode;
};

// Tooltip state and refs - Kept in component as it's purely view-related
const showHostTooltip = ref(false);
const hostTooltipStyle = ref({});
const hostIconRef = ref<HTMLElement | null>(null);
const hostTooltipContentRef = ref<HTMLElement | null>(null);

const handleHostIconMouseEnter = async () => {
  showHostTooltip.value = true;
  await nextTick();

  if (hostIconRef.value && hostTooltipContentRef.value) {
    const iconRect = hostIconRef.value.getBoundingClientRect();
    const tooltipRect = hostTooltipContentRef.value.getBoundingClientRect();

    let top = iconRect.top - tooltipRect.height - 8;
    let left = iconRect.left + iconRect.width / 2 - tooltipRect.width / 2;

    if (top < 0) {
      top = iconRect.bottom + 8;
    }
    if (left < 0) {
      left = 0;
    }
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width;
    }

    hostTooltipStyle.value = {
      top: `${top}px`,
      left: `${left}px`,
    };
  }
};

const handleHostIconMouseLeave = () => {
  showHostTooltip.value = false;
};
</script>

<template>
  <!-- Host Tooltip is managed by AddConnectionFormBasicInfo for its specific host input,
       but if there was a general tooltip at this level, Teleport would be here.
       The original Teleport for host tooltip is removed as it's now encapsulated. -->
  <div class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4">
    <!-- Overlay -->
    <div
      class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col"
    >
      <!-- Form Panel -->
      <h3 class="text-xl font-semibold text-center mb-6 flex-shrink-0">{{ formTitle }}</h3>
      <!-- Title -->
      <form @submit.prevent="handleSubmit" class="flex-grow overflow-y-auto pr-2 space-y-6">
        <!-- Form with scroll and spacing -->

        <!-- Regular Form Sections (conditionally rendered) -->
        <template v-if="!isScriptModeActive">
          <AddConnectionFormBasicInfo :form-data="formData" />
          <AddConnectionFormAuth :form-data="formData" :is-edit-mode="isEditMode" />
          <AddConnectionFormAdvanced
            :form-data="formData"
            :proxies="proxies"
            :tags="tags"
            :connections="connections"
            :is-proxy-loading="isProxyLoading"
            :proxy-store-error="proxyStoreError"
            :is-tag-loading="isTagLoading"
            :tag-store-error="tagStoreError"
            :advanced-connection-mode="advancedConnectionMode"
            @update:advancedConnectionMode="handleAdvancedConnectionModeUpdate"
            :add-jump-host="addJumpHost"
            :remove-jump-host="removeJumpHost"
            @create-tag="handleCreateTag"
            @delete-tag="handleDeleteTag"
          />
        </template>

        <!-- Script Mode Section Toggle -->
        <div
          v-if="!isEditMode"
          class="space-y-4 p-4 border border-border rounded-md bg-header/30 mt-6"
        >
          <div class="flex justify-between items-center">
            <h4 class="text-base font-semibold">
              {{ t('connections.form.sectionScriptMode', '脚本模式') }}
            </h4>
            <button
              type="button"
              @click="isScriptModeActive = !isScriptModeActive"
              :class="[
                'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
                isScriptModeActive ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
              ]"
              role="switch"
              :aria-checked="isScriptModeActive"
            >
              <span
                aria-hidden="true"
                :class="[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
                  isScriptModeActive ? 'translate-x-5' : 'translate-x-0',
                ]"
              ></span>
            </button>
          </div>
          <div v-if="isScriptModeActive" class="mt-4">
            <textarea
              id="conn-script-input"
              v-model="scriptInputText"
              rows="10"
              wrap="off"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              :placeholder="t('connections.form.scriptModePlaceholder')"
            ></textarea>
            <p class="mt-1 text-xs text-text-secondary whitespace-pre-line">
              {{ scriptModeFormatInfo }}
            </p>
          </div>
        </div>

        <!-- Error message DIV removed -->
      </form>
      <!-- End Form -->

      <!-- Form Actions -->
      <div class="flex justify-between items-center pt-5 mt-6 flex-shrink-0">
        <!-- Test Area (Only show for SSH and when script mode is NOT active) -->
        <div
          v-if="formData.type === 'SSH' && !isScriptModeActive"
          class="flex flex-col items-start gap-1"
        >
          <div class="flex items-center gap-2">
            <!-- Button and Icon -->
            <button
              type="button"
              @click="handleTestConnection"
              :disabled="isLoading || testStatus === 'testing'"
              class="px-3 py-1.5 border border-border rounded-md text-sm font-medium text-text-secondary bg-background hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center transition-colors duration-150"
            >
              <svg
                v-if="testStatus === 'testing'"
                class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-text-secondary"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              {{ testButtonText }}
            </button>
            <div class="relative group">
              <!-- Tooltip Container -->
              <i class="fas fa-info-circle text-text-secondary cursor-help"></i>
              <span
                class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-max max-w-xs p-2 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10 whitespace-pre-wrap"
              >
                {{ t('connections.test.latencyTooltip') }}
              </span>
            </div>
          </div>
          <!-- Test Result -->
          <div class="min-h-[1.2em] pl-1 text-xs">
            <div v-if="testStatus === 'testing'" class="text-text-secondary animate-pulse">
              {{ t('connections.test.testingInProgress', '测试中...') }}
            </div>
            <div
              v-else-if="testStatus === 'success'"
              class="font-medium"
              :style="{ color: latencyColor }"
            >
              {{ testResult }}
            </div>
            <div v-else-if="testStatus === 'error'" class="text-error font-medium">
              <!-- Error message is now shown via uiNotificationsStore -->
              <!-- Display a generic message or icon here if needed, or leave empty -->
              {{ t('connections.test.errorPrefix', '错误:') }} {{ testResult }}
              <!-- Or simply 'Error' -->
            </div>
          </div>
        </div>
        <!-- Placeholder for alignment when test button is hidden or script mode is active -->
        <div v-else-if="!isScriptModeActive" class="flex-1"></div>
        <div v-else class="flex-1"></div>
        <!-- Also take up space if script mode is active, pushing buttons right -->
        <div class="flex space-x-3">
          <!-- Main Actions -->
          <button
            v-if="isEditMode && !isScriptModeActive"
            type="button"
            @click="handleDeleteConnection"
            :disabled="isLoading || (formData.type === 'SSH' && testStatus === 'testing')"
            class="px-4 py-2 bg-transparent text-red-600 border border-red-500 rounded-md shadow-sm hover:bg-red-500/10 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            {{ t('connections.actions.delete') }}
          </button>
          <button
            type="submit"
            @click="handleSubmit"
            :disabled="isLoading || (formData.type === 'SSH' && testStatus === 'testing')"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            {{ submitButtonText }}
          </button>
          <button
            type="button"
            @click="emit('close')"
            :disabled="isLoading || (formData.type === 'SSH' && testStatus === 'testing')"
            class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            {{ t('connections.form.cancel') }}
          </button>
        </div>
      </div>
      <!-- End Form Actions -->
    </div>
    <!-- End Form Panel -->
  </div>
  <!-- End Overlay -->
</template>

<!-- Scoped styles removed, now using Tailwind utility classes -->
