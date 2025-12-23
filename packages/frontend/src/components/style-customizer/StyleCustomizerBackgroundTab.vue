<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import { storeToRefs } from 'pinia';
import { useConfirmDialog } from '../../composables/useConfirmDialog';

const { t } = useI18n();
const { showConfirmDialog } = useConfirmDialog();
const appearanceStore = useAppearanceStore();
const notificationsStore = useUiNotificationsStore();

// Existing state for background image and overlay
const {
  terminalBackgroundImage,
  isTerminalBackgroundEnabled,
  currentTerminalBackgroundOverlayOpacity,
  // terminalCustomHTML, // This will be replaced by preset logic
  // HTML Preset related state from store
  localHtmlPresets,
  remoteHtmlPresets,
  remoteHtmlPresetsRepositoryUrl,
  activeHtmlPresetTab, // This is the ref from the store
  isLoadingHtmlPresets,
  htmlPresetError,
} = storeToRefs(appearanceStore);

// Actions from store
const {
  fetchLocalHtmlPresets,
  getLocalHtmlPresetContent,
  createLocalHtmlPreset,
  updateLocalHtmlPreset,
  deleteLocalHtmlPreset,
  fetchRemoteHtmlPresetsRepositoryUrl,
  updateRemoteHtmlPresetsRepositoryUrl,
  fetchRemoteHtmlPresets,
  getRemoteHtmlPresetContent,
  applyHtmlPreset,
} = appearanceStore;

const localTerminalBackgroundEnabled = ref(true);
const editableTerminalBackgroundOverlayOpacity = ref(0.5);
// const localTerminalCustomHTML = ref(''); // Replaced by preset editing

const terminalBgFileInput = ref<HTMLInputElement | null>(null);
const uploadError = ref<string | null>(null);

// Component's internal active tab, synced with store's activeHtmlPresetTab
const currentActiveTab = ref<'local' | 'remote'>('local');

// State for local preset editing/creating
const showPresetEditor = ref(false);
const editingPreset = ref<{ name: string; content: string } | null>(null); // For editing existing
const newPresetName = ref('');
const newPresetContent = ref('');

// State for remote presets
const localRemoteHtmlPresetsRepositoryUrl = ref('');
const localHtmlSearchTerm = ref('');
const remoteHtmlSearchTerm = ref('');

const localSpecificLoading = ref(false);
const remoteSpecificLoading = ref(false);

const initializeEditableState = () => {
  localTerminalBackgroundEnabled.value = isTerminalBackgroundEnabled.value;
  editableTerminalBackgroundOverlayOpacity.value = currentTerminalBackgroundOverlayOpacity.value;
  // localTerminalCustomHTML.value = terminalCustomHTML.value || ''; // Replaced
  uploadError.value = null;
  currentActiveTab.value = activeHtmlPresetTab.value; // Sync with store state
  localRemoteHtmlPresetsRepositoryUrl.value =
    remoteHtmlPresetsRepositoryUrl.value ||
    'https://github.com/Silentely/nexus-terminal/tree/main/doc/custom_html_theme';
};

onMounted(async () => {
  initializeEditableState();
  localSpecificLoading.value = true;
  try {
    await fetchLocalHtmlPresets();
  } finally {
    localSpecificLoading.value = false;
  }

  // Fetch remote URL if not already set, or always? Per plan, store initializes it.
  // If store's remoteHtmlPresetsRepositoryUrl is null, then fetch it.
  if (!remoteHtmlPresetsRepositoryUrl.value) {
    await fetchRemoteHtmlPresetsRepositoryUrl();
  }
  // If a URL exists, fetch remote presets
  if (remoteHtmlPresetsRepositoryUrl.value) {
    remoteSpecificLoading.value = true;
    try {
      await fetchRemoteHtmlPresets();
    } finally {
      remoteSpecificLoading.value = false;
    }
  }
});

watch(isTerminalBackgroundEnabled, (newValue) => {
  if (localTerminalBackgroundEnabled.value !== newValue) {
    localTerminalBackgroundEnabled.value = newValue;
  }
});

watch(currentTerminalBackgroundOverlayOpacity, (newValue) => {
  if (editableTerminalBackgroundOverlayOpacity.value !== newValue) {
    editableTerminalBackgroundOverlayOpacity.value = newValue;
  }
});

// Watch store's activeHtmlPresetTab and update local component state
watch(activeHtmlPresetTab, (newTab) => {
  currentActiveTab.value = newTab;
});

watch(remoteHtmlPresetsRepositoryUrl, (newUrl) => {
  localRemoteHtmlPresetsRepositoryUrl.value = newUrl || '';
});

const handleTriggerTerminalBgUpload = () => {
  uploadError.value = null;
  terminalBgFileInput.value?.click();
};

const handleTerminalBgUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    try {
      await appearanceStore.uploadTerminalBackground(file);
      notificationsStore.addNotification({
        type: 'success',
        message: t('styleCustomizer.terminalBgUploadSuccess'),
      });
      input.value = '';
    } catch (error: any) {
      const determinedErrorMessage = error.message || t('styleCustomizer.uploadFailed');
      uploadError.value = determinedErrorMessage;
      notificationsStore.addNotification({ type: 'error', message: determinedErrorMessage });
      input.value = '';
    }
  }
};

const handleRemoveTerminalBg = async () => {
  try {
    await appearanceStore.removeTerminalBackground();
    notificationsStore.addNotification({
      type: 'success',
      message: t('styleCustomizer.terminalBgRemoved'),
    });
  } catch (error: any) {
    console.error('移除终端背景失败:', error);
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.removeBgFailed', { message: error.message }),
    });
  }
};

const handleToggleTerminalBackground = async () => {
  const newValue = !localTerminalBackgroundEnabled.value;
  localTerminalBackgroundEnabled.value = newValue;
  try {
    await appearanceStore.setTerminalBackgroundEnabled(newValue);
  } catch (error: any) {
    console.error('更新终端背景启用状态失败:', error);
    localTerminalBackgroundEnabled.value = !newValue;
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.errorToggleTerminalBg', { message: error.message }),
    });
  }
};

const handleSaveTerminalBackgroundOverlayOpacity = async () => {
  try {
    const opacity = Number(editableTerminalBackgroundOverlayOpacity.value);
    if (isNaN(opacity) || opacity < 0 || opacity > 1) {
      notificationsStore.addNotification({
        type: 'error',
        message: t('styleCustomizer.errorInvalidOpacityValue'),
      });
      return;
    }
    await appearanceStore.setTerminalBackgroundOverlayOpacity(opacity);
    notificationsStore.addNotification({
      type: 'success',
      message: t('styleCustomizer.terminalBgOverlayOpacitySaved'),
    });
  } catch (error: any) {
    console.error('保存终端背景蒙版透明度失败:', error);
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.terminalBgOverlayOpacitySaveFailed', { message: error.message }),
    });
  }
};

// --- HTML Preset Functions ---
const switchTab = (tab: 'local' | 'remote') => {
  appearanceStore.activeHtmlPresetTab = tab; // Update store, which will update currentActiveTab via watcher
};

const handleApplyPreset = async (htmlContent: string) => {
  try {
    await applyHtmlPreset(htmlContent);
    notificationsStore.addNotification({
      type: 'success',
      message: t('styleCustomizer.htmlPresetApplied'),
    });
  } catch (error: any) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.htmlPresetApplyFailed', { message: error.message }),
    });
  }
};

const handleResetCustomHtml = async () => {
  try {
    await applyHtmlPreset(''); // Apply empty HTML to reset
    notificationsStore.addNotification({
      type: 'success',
      message: t('styleCustomizer.customHtmlResetSuccess', '自定义 HTML 已重置。'),
    });
  } catch (error: any) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.customHtmlResetFailed', { message: error.message }),
    });
  }
};

// Local preset functions
const openNewPresetEditor = () => {
  editingPreset.value = null;
  newPresetName.value = '';
  newPresetContent.value = '';
  showPresetEditor.value = true;
};

const openEditPresetEditor = (preset: { name: string; content: string }) => {
  // This is for editing CUSTOM themes
  editingPreset.value = { ...preset };
  newPresetName.value = preset.name.replace(/\.html$/, ''); // Remove .html for editing
  newPresetContent.value = preset.content;
  showPresetEditor.value = true;
};

// New function to handle "Edit" for a preset theme, which means creating a new custom theme based on it
const handleEditPresetAsNew = async (preset: { name: string; type: 'preset' | 'custom' }) => {
  if (preset.type !== 'preset') {
    console.warn('handleEditPresetAsNew called with a non-preset theme. This should not happen.');
    // Fallback to regular edit if it's somehow a custom theme
    const content = await getLocalHtmlPresetContent(preset.name);
    openEditPresetEditor({ name: preset.name, content });
    return;
  }

  try {
    const content = await getLocalHtmlPresetContent(preset.name); // Get content of the preset
    editingPreset.value = null; // Important: we are creating a NEW theme
    newPresetName.value = `${preset.name.replace(/\.html$/, '')}(1)`; // Default new name
    newPresetContent.value = content;
    showPresetEditor.value = true;
  } catch (e: any) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.errorFetchingPresetContentForCopy', {
        message: e.message,
        name: preset.name,
      }),
    });
  }
};

const handleSaveLocalPreset = async () => {
  const desiredBaseName = newPresetName.value.trim(); // Name without .html, from input
  const content = newPresetContent.value.trim();

  if (!desiredBaseName) {
    // It's recommended to add this key to your i18n files, e.g., "Preset name cannot be empty."
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.errorPresetNameRequired', '预设名称不能为空。'),
    });
    return;
  }
  if (!content) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.errorPresetContentRequired'),
    });
    return;
  }

  const finalNewFullName = desiredBaseName.endsWith('.html')
    ? desiredBaseName
    : `${desiredBaseName}.html`;

  if (editingPreset.value) {
    // Editing existing
    const originalFullName = editingPreset.value.name; // Original name with .html

    if (finalNewFullName === originalFullName) {
      // Name hasn't changed, only content might have
      try {
        await updateLocalHtmlPreset(originalFullName, content);
        notificationsStore.addNotification({
          type: 'success',
          message: t('styleCustomizer.localPresetUpdated'),
        });
        showPresetEditor.value = false;
      } catch (error: any) {
        notificationsStore.addNotification({
          type: 'error',
          message: t('styleCustomizer.localPresetUpdateFailed', { message: error.message }),
        });
      }
    } else {
      // Name has changed: "Rename" by creating new and deleting old
      try {
        // Attempt to create the new preset first. If this name already exists, createLocalHtmlPreset should throw an error.
        await createLocalHtmlPreset(finalNewFullName, content);
        // If creation was successful, delete the old preset
        await deleteLocalHtmlPreset(originalFullName);
        // It's recommended to add this key to your i18n files, e.g., "Local preset '{oldName}' has been renamed to '{newName}'."
        notificationsStore.addNotification({
          type: 'success',
          message: t('styleCustomizer.localPresetRenamed', {
            oldName: originalFullName.replace(/\.html$/, ''),
            newName: desiredBaseName,
          }),
        });
        showPresetEditor.value = false;
      } catch (error: any) {
        // It's recommended to add this key to your i18n files, e.g., "Failed to rename local preset: {message}"
        notificationsStore.addNotification({
          type: 'error',
          message: t('styleCustomizer.localPresetRenameFailed', { message: error.message }),
        });
      }
    }
  } else {
    // Creating new
    // Validation for new name and content already happened above
    try {
      await createLocalHtmlPreset(finalNewFullName, content);
      notificationsStore.addNotification({
        type: 'success',
        message: t('styleCustomizer.localPresetCreated'),
      });
      showPresetEditor.value = false;
      newPresetName.value = ''; // Clear fields for next new preset
      newPresetContent.value = '';
    } catch (error: any) {
      notificationsStore.addNotification({
        type: 'error',
        message: t('styleCustomizer.localPresetCreateFailed', { message: error.message }),
      });
    }
  }
};

const handleDeleteLocalPreset = async (name: string) => {
  const displayName = name.replace(/\.html$/, '');
  const confirmed = await showConfirmDialog({
    message: t('styleCustomizer.confirmDeletePreset', { name: displayName }),
  });
  if (confirmed) {
    try {
      await deleteLocalHtmlPreset(name);
      notificationsStore.addNotification({
        type: 'success',
        message: t('styleCustomizer.localPresetDeleted'),
      });
    } catch (error: any) {
      notificationsStore.addNotification({
        type: 'error',
        message: t('styleCustomizer.localPresetDeleteFailed', { message: error.message }),
      });
    }
  }
};

// Remote preset functions
const handleSaveRemoteRepositoryUrl = async () => {
  // Allow saving an empty URL to disable remote presets
  try {
    await updateRemoteHtmlPresetsRepositoryUrl(localRemoteHtmlPresetsRepositoryUrl.value);
    notificationsStore.addNotification({
      type: 'success',
      message: t('styleCustomizer.remoteUrlSaved'),
    });
    // Optionally fetch presets immediately after saving new URL
    if (localRemoteHtmlPresetsRepositoryUrl.value) {
      remoteSpecificLoading.value = true;
      try {
        await fetchRemoteHtmlPresets(localRemoteHtmlPresetsRepositoryUrl.value);
      } finally {
        remoteSpecificLoading.value = false;
      }
    } else {
      // If URL is cleared, ensure remote presets are cleared and loading indicator is off.
      // The store's fetchRemoteHtmlPresets might handle clearing presets if URL is empty.
      if (remoteHtmlPresets.value?.length) remoteHtmlPresets.value = [];
      remoteSpecificLoading.value = false;
    }
  } catch (error: any) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.remoteUrlSaveFailed', { message: error.message }),
    });
    remoteSpecificLoading.value = false; // Ensure loading indicator is off on error
  }
};

const handleLoadRemotePresets = async () => {
  if (!remoteHtmlPresetsRepositoryUrl.value) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.errorSetRemoteUrlFirst'),
    });
    return;
  }
  remoteSpecificLoading.value = true;
  try {
    await fetchRemoteHtmlPresets();
    if (!htmlPresetError.value) {
      notificationsStore.addNotification({
        type: 'success',
        message: t('styleCustomizer.remotePresetsLoaded'),
      });
    }
  } catch (error: any) {
    // This catch might not be needed if store handles errors
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.remotePresetsLoadFailed', { message: error.message }),
    });
  } finally {
    remoteSpecificLoading.value = false;
  }
};

// Placeholder for applying a local theme (needs to fetch content first)
const applyLocalPreset = async (presetName: string) => {
  try {
    const content = await getLocalHtmlPresetContent(presetName);
    await handleApplyPreset(content);
  } catch (error: any) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.localPresetApplyFailed', { message: error.message }),
    });
  }
};

// Placeholder for applying a remote theme (needs to fetch content first)
const applyRemotePreset = async (downloadUrl?: string) => {
  if (!downloadUrl) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.errorMissingDownloadUrl'),
    });
    return;
  }
  try {
    const content = await getRemoteHtmlPresetContent(downloadUrl);
    await handleApplyPreset(content);
  } catch (error: any) {
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.remotePresetApplyFailed', { message: error.message }),
    });
  }
};

const filteredLocalHtmlPresets = computed(() => {
  const searchTerm = localHtmlSearchTerm.value.toLowerCase().trim();
  let presets = [...localHtmlPresets.value]; // Make a copy to sort
  if (searchTerm) {
    presets = presets.filter((preset) =>
      preset.name
        .replace(/\.html$/, '')
        .toLowerCase()
        .includes(searchTerm)
    );
  }
  // Sort by name
  presets.sort((a, b) =>
    a.name.replace(/\.html$/, '').localeCompare(b.name.replace(/\.html$/, ''))
  );
  return presets;
});

const filteredRemoteHtmlPresets = computed(() => {
  const searchTerm = remoteHtmlSearchTerm.value.toLowerCase().trim();
  let presets = [...remoteHtmlPresets.value]; // Make a copy to sort
  if (searchTerm) {
    presets = presets.filter((preset) =>
      preset.name
        .replace(/\.html$/, '')
        .toLowerCase()
        .includes(searchTerm)
    );
  }
  presets.sort((a, b) =>
    a.name.replace(/\.html$/, '').localeCompare(b.name.replace(/\.html$/, ''))
  );
  return presets;
});
</script>

<template>
  <section>
    <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">
      {{ t('styleCustomizer.backgroundSettings') }}
    </h3>

    <!-- Tab Switcher -->

    <hr class="my-4 md:my-8 border-border" />

    <!-- Existing Terminal Background Image Settings -->
    <div class="flex items-center justify-between mb-3">
      <h4 class="m-0 text-base font-semibold text-foreground">
        {{ t('styleCustomizer.terminalBackground') }}
      </h4>
      <button
        type="button"
        @click="handleToggleTerminalBackground"
        :class="[
          'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
          localTerminalBackgroundEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
        ]"
        role="switch"
        :aria-checked="localTerminalBackgroundEnabled"
      >
        <span
          aria-hidden="true"
          :class="[
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
            localTerminalBackgroundEnabled ? 'translate-x-5' : 'translate-x-0',
          ]"
        ></span>
      </button>
    </div>

    <div v-if="localTerminalBackgroundEnabled">
      <div
        class="w-full h-[100px] md:h-[150px] border border-dashed border-border mb-2 flex justify-center items-center text-text-secondary bg-cover bg-center bg-no-repeat rounded bg-header relative overflow-hidden"
        :style="{
          backgroundImage: terminalBackgroundImage ? `url(${terminalBackgroundImage})` : 'none',
        }"
      >
        <div
          v-if="terminalBackgroundImage"
          class="absolute inset-0"
          :style="{ backgroundColor: `rgba(0, 0, 0, ${editableTerminalBackgroundOverlayOpacity})` }"
        ></div>
        <span
          v-if="!terminalBackgroundImage"
          class="bg-[var(--app-bg-color)]/80 px-3 py-1.5 rounded text-sm font-medium text-foreground shadow-sm relative z-10"
          >{{ t('styleCustomizer.noBackground') }}</span
        >
      </div>
      <div class="flex gap-2 mb-4 flex-wrap items-center">
        <button
          @click="handleTriggerTerminalBgUpload"
          class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {{ t('styleCustomizer.uploadTerminalBg') }}
        </button>
        <button
          @click="handleRemoveTerminalBg"
          :disabled="!terminalBackgroundImage"
          class="px-3 py-1.5 text-sm border rounded transition duration-200 ease-in-out whitespace-nowrap bg-error/10 text-error border-error/30 hover:bg-error/20 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {{ t('styleCustomizer.removeTerminalBg') }}
        </button>
        <input
          type="file"
          ref="terminalBgFileInput"
          @change="handleTerminalBgUpload"
          accept="image/*"
          class="hidden"
        />
      </div>

      <div class="mt-4 pt-4 border-t border-border/50">
        <label
          for="terminalBgOverlayOpacity"
          class="block text-sm font-medium text-foreground mb-1"
          >{{ t('styleCustomizer.terminalBgOverlayOpacity', '终端背景蒙版透明度:') }}</label
        >
        <div class="flex items-center gap-3">
          <input
            type="range"
            id="terminalBgOverlayOpacity"
            v-model.number="editableTerminalBackgroundOverlayOpacity"
            min="0"
            max="1"
            step="0.01"
            class="w-full cursor-pointer accent-primary"
          />
          <span class="text-sm text-foreground min-w-[3em] text-right">{{
            editableTerminalBackgroundOverlayOpacity.toFixed(2)
          }}</span>
          <button
            @click="handleSaveTerminalBackgroundOverlayOpacity"
            class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
      <!-- Old custom HTML textarea is removed from here -->
    </div>
    <div
      v-else
      class="p-4 text-center text-text-secondary italic border border-dashed border-border/50 rounded-md"
    >
      {{ t('styleCustomizer.terminalBgDisabled', '终端背景功能已禁用。') }}
    </div>

    <hr class="my-6 border-border" />
    <div v-if="localTerminalBackgroundEnabled">
      <!-- Tab Switcher for HTML Background Themes -->
      <div class="flex items-center gap-2 mb-3">
        <h4 class="mt-0 text-base font-semibold text-foreground">
          {{ t('styleCustomizer.htmlBackgroundThemes') }}
        </h4>
        <button
          @click="handleResetCustomHtml"
          type="button"
          class="p-1.5 text-xs rounded text-foreground hover:bg-border transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <i class="fa-solid fa-rotate-left"></i>
        </button>
      </div>
      <div class="mb-4 flex border-b border-border">
        <button
          @click="switchTab('local')"
          :class="[
            'px-4 py-2 -mb-px border-b-2 transition-colors duration-150',
            currentActiveTab === 'local'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent hover:border-gray-400 dark:hover:border-gray-500 text-text-secondary hover:text-foreground',
          ]"
        >
          {{ t('styleCustomizer.localThemes') }}
        </button>
        <button
          @click="switchTab('remote')"
          :class="[
            'px-4 py-2 -mb-px border-b-2 transition-colors duration-150',
            currentActiveTab === 'remote'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent hover:border-gray-400 dark:hover:border-gray-500 text-text-secondary hover:text-foreground',
          ]"
        >
          {{ t('styleCustomizer.remoteThemes') }}
        </button>
      </div>

      <!-- Content based on active tab -->
      <div v-if="currentActiveTab === 'local'">
        <!-- Flex container for search and new preset button -->
        <div class="mb-4 flex items-center gap-4">
          <input
            type="text"
            v-model="localHtmlSearchTerm"
            :placeholder="t('styleCustomizer.searchLocalThemesPlaceholder', '搜索本地主题...')"
            class="flex-grow border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            @click="openNewPresetEditor"
            class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap flex-shrink-0"
          >
            {{ t('styleCustomizer.addNewTheme') }}
          </button>
        </div>

        <div v-if="localSpecificLoading" class="text-center p-4 text-text-secondary">
          {{ t('common.loading') }}
        </div>
        <ul
          v-else-if="filteredLocalHtmlPresets.length > 0"
          class="list-none p-0 mt-4 max-h-[200px] md:max-h-[280px] overflow-y-auto border border-border rounded bg-background"
        >
          <li
            v-for="(preset, index) in filteredLocalHtmlPresets"
            :key="preset.name"
            :class="[
              'block md:grid md:grid-cols-[1fr_auto] items-center px-3 py-2.5 text-sm md:text-[0.95rem] transition-colors duration-200 ease-in-out gap-2',
              index < filteredLocalHtmlPresets.length - 1 ? 'border-b border-border' : '',
              'hover:bg-header',
            ]"
          >
            <div
              class="flex items-center gap-2 md:col-start-1 md:col-end-2 overflow-hidden text-ellipsis whitespace-nowrap mb-2 md:mb-0"
            >
              <span
                class="text-foreground font-medium"
                :title="preset.name.replace(/\.html$/, '')"
                >{{ preset.name.replace(/\.html$/, '') }}</span
              >
              <span
                v-if="preset.type === 'preset'"
                class="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-700 dark:text-blue-200"
              >
                {{ t('styleCustomizer.presetTag', '预设') }}
              </span>
              <span
                v-else-if="preset.type === 'custom'"
                class="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-700 dark:text-green-200"
              >
                {{ t('styleCustomizer.customTag', '自定义') }}
              </span>
            </div>
            <div
              class="flex md:col-start-2 md:col-end-3 flex-shrink-0 gap-2 justify-start md:justify-end flex-wrap"
            >
              <button
                @click="applyLocalPreset(preset.name)"
                :title="t('styleCustomizer.applyThemeTooltip', 'Apply this theme')"
                class="px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap border-border bg-header text-foreground hover:bg-border hover:border-text-secondary"
              >
                {{ t('common.apply') }}
              </button>
              <button
                v-if="preset.type === 'custom'"
                @click="
                  async () => {
                    try {
                      const content = await getLocalHtmlPresetContent(preset.name);
                      openEditPresetEditor({ name: preset.name, content });
                    } catch (e: any) {
                      notificationsStore.addNotification({
                        type: 'error',
                        message: t('styleCustomizer.errorFetchingPresetContentForEdit', {
                          message: e.message,
                        }),
                      });
                    }
                  }
                "
                :title="t('common.edit')"
                class="px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap border-border bg-header text-foreground hover:bg-border hover:border-text-secondary"
              >
                {{ t('common.edit') }}
              </button>
              <button
                v-if="preset.type === 'preset'"
                @click="handleEditPresetAsNew(preset)"
                :title="t('styleCustomizer.editAsNewTooltip', '编辑为新自定义主题')"
                class="px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap border-border bg-header text-foreground hover:bg-border hover:border-text-secondary"
              >
                {{ t('common.edit') }}
              </button>
              <button
                v-if="preset.type === 'custom'"
                @click="handleDeleteLocalPreset(preset.name)"
                :title="t('common.delete')"
                class="px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap bg-error/10 text-error border-error/30 hover:bg-error/20"
              >
                {{ t('common.delete') }}
              </button>
            </div>
          </li>
        </ul>
        <div
          v-else-if="htmlPresetError"
          class="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg dark:bg-red-200 dark:text-red-800"
          role="alert"
        >
          {{ htmlPresetError }}
        </div>
        <div
          v-else
          class="text-center p-4 text-text-secondary italic border border-dashed border-border rounded-md"
        >
          {{
            localHtmlSearchTerm
              ? t('styleCustomizer.noMatchingLocalPresetsFound', '未找到匹配的本地主题')
              : t('styleCustomizer.noLocalPresetsFound')
          }}
        </div>
      </div>

      <div v-if="currentActiveTab === 'remote'">
        <!-- URL Input and Buttons Container -->
        <div class="mb-4">
          <label for="remoteRepoUrl" class="block text-sm font-medium text-foreground mb-1">{{
            t('styleCustomizer.remoteHtmlPresetsRepositoryUrl')
          }}</label>
          <div class="flex items-center gap-2">
            <input
              type="text"
              id="remoteRepoUrl"
              v-model="localRemoteHtmlPresetsRepositoryUrl"
              class="flex-grow p-2 border border-border rounded bg-input text-foreground focus:ring-primary focus:border-primary"
              :placeholder="
                t(
                  'styleCustomizer.remoteRepoUrlPlaceholder',
                  'https://github.com/Silentely/nexus-terminal/tree/main/doc/custom_html_theme'
                )
              "
            />
            <button
              @click="handleSaveRemoteRepositoryUrl"
              class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap flex-shrink-0"
            >
              {{ t('common.save') }}
            </button>
            <button
              @click="handleLoadRemotePresets"
              :disabled="!remoteHtmlPresetsRepositoryUrl || remoteSpecificLoading"
              class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap disabled:opacity-50 flex-shrink-0"
            >
              {{
                remoteSpecificLoading ? t('common.loading') : t('styleCustomizer.loadRemoteThemes')
              }}
            </button>
          </div>
        </div>

        <!-- Search Box Container -->
        <div class="mb-4">
          <input
            type="text"
            v-model="remoteHtmlSearchTerm"
            :placeholder="t('styleCustomizer.searchRemoteThemesPlaceholder', '搜索远程主题...')"
            class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div
          v-if="remoteSpecificLoading && currentActiveTab === 'remote'"
          class="text-center p-4 text-text-secondary"
        >
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="htmlPresetError && currentActiveTab === 'remote'"
          class="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg dark:bg-red-200 dark:text-red-800"
          role="alert"
        >
          {{ htmlPresetError }}
        </div>
        <div
          v-else-if="!remoteHtmlPresetsRepositoryUrl"
          class="text-center p-4 text-text-secondary italic border border-dashed border-border rounded-md"
        >
          {{ t('styleCustomizer.pleaseSetRemoteUrl') }}
        </div>
        <ul
          v-else-if="filteredRemoteHtmlPresets.length > 0 && remoteHtmlPresetsRepositoryUrl"
          class="list-none p-0 mt-4 max-h-[200px] md:max-h-[280px] overflow-y-auto border border-border rounded bg-background"
        >
          <li
            v-for="(preset, index) in filteredRemoteHtmlPresets"
            :key="preset.name"
            :class="[
              'block md:grid md:grid-cols-[1fr_auto] items-center px-3 py-2.5 text-sm md:text-[0.95rem] transition-colors duration-200 ease-in-out gap-2',
              index < filteredRemoteHtmlPresets.length - 1 ? 'border-b border-border' : '',
              'hover:bg-header',
            ]"
          >
            <span
              class="block md:col-start-1 md:col-end-2 overflow-hidden text-ellipsis whitespace-nowrap mb-2 md:mb-0 text-foreground font-medium"
              :title="preset.name.replace(/\.html$/, '')"
              >{{ preset.name.replace(/\.html$/, '') }}</span
            >
            <div
              class="flex md:col-start-2 md:col-end-3 flex-shrink-0 gap-2 justify-start md:justify-end flex-wrap"
            >
              <button
                @click="applyRemotePreset(preset.downloadUrl)"
                :disabled="!preset.downloadUrl"
                :title="t('styleCustomizer.applyThemeTooltip', 'Apply this theme')"
                class="px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap border-border bg-header text-foreground hover:bg-border hover:border-text-secondary disabled:opacity-50"
              >
                {{ t('common.apply') }}
              </button>
            </div>
          </li>
        </ul>
        <div
          v-else-if="remoteHtmlPresetsRepositoryUrl"
          class="text-center p-4 text-text-secondary italic border border-dashed border-border rounded-md"
        >
          {{
            remoteHtmlSearchTerm
              ? t('styleCustomizer.noMatchingRemotePresetsFound', '未找到匹配的远程主题')
              : t('styleCustomizer.noRemotePresetsFound')
          }}
        </div>
      </div>
    </div>

    <!-- Preset Editor (Modal or Inline) - Simplified for now -->
    <div
      v-if="showPresetEditor"
      class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      @click.self="showPresetEditor = false"
    >
      <div class="bg-background p-6 rounded-lg shadow-xl w-full max-w-lg">
        <div class="mb-4">
          <label for="presetName" class="block text-sm font-medium text-foreground mb-1">{{
            t('styleCustomizer.presetName')
          }}</label>
          <input
            type="text"
            id="presetName"
            v-model="newPresetName"
            class="w-full p-2 border border-border rounded bg-input text-foreground focus:ring-primary focus:border-primary"
            :placeholder="t('styleCustomizer.presetNamePlaceholder', 'my-theme')"
          />
        </div>
        <div class="mb-4">
          <label for="presetContent" class="block text-sm font-medium text-foreground mb-1">{{
            t('styleCustomizer.presetContent')
          }}</label>
          <textarea
            id="presetContent"
            v-model="newPresetContent"
            rows="10"
            class="w-full p-2 border border-border rounded bg-input text-foreground focus:ring-primary focus:border-primary"
            :placeholder="
              t('styleCustomizer.customTerminalHTMLPlaceholder', '例如：<h1>Hello</h1>')
            "
          ></textarea>
        </div>
        <div class="flex justify-end gap-2">
          <button
            @click="showPresetEditor = false"
            class="px-4 py-2 text-sm border border-border rounded bg-header hover:bg-border transition"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="handleSaveLocalPreset"
            class="px-4 py-2 text-sm rounded bg-primary text-white hover:bg-primary/90 transition"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
