<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import { storeToRefs } from 'pinia';

const { t } = useI18n();
const appearanceStore = useAppearanceStore();
const notificationsStore = useUiNotificationsStore();
const {
  appearanceSettings, // for watcher
  currentEditorFontSize,
  currentEditorFontFamily,
} = storeToRefs(appearanceStore);

const editableEditorFontSize = ref(14);
const editableEditorFontFamily = ref('');

const initializeEditableState = () => {
  editableEditorFontSize.value = currentEditorFontSize.value;
  editableEditorFontFamily.value = currentEditorFontFamily.value;
};

onMounted(initializeEditableState);

watch(
  () => appearanceSettings.value,
  (newSettings, oldSettings) => {
    // Check if the specific properties we care about have changed
    const fontSizeChanged = newSettings?.editorFontSize !== oldSettings?.editorFontSize;
    const fontFamilyChanged = newSettings?.editorFontFamily !== oldSettings?.editorFontFamily;

    if (fontSizeChanged) {
      editableEditorFontSize.value = newSettings?.editorFontSize || 14;
    }
    if (fontFamilyChanged) {
      editableEditorFontFamily.value =
        newSettings?.editorFontFamily || 'Consolas, "Noto Sans SC", "Microsoft YaHei"';
    }
  },
  { deep: true }
);

// 保存编辑器字体大小
const handleSaveEditorFontSize = async () => {
  try {
    const size = Number(editableEditorFontSize.value);
    if (isNaN(size) || size <= 0) {
      notificationsStore.addNotification({
        type: 'error',
        message: t('styleCustomizer.errorInvalidEditorFontSize'),
      });
      return;
    }
    await appearanceStore.setEditorFontSize(size);
    notificationsStore.addNotification({
      type: 'success',
      message: t('styleCustomizer.editorFontSizeSaved'),
    });
  } catch (error: any) {
    console.error('保存编辑器字体大小失败:', error);
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.editorFontSizeSaveFailed', { message: error.message }),
    });
  }
};

// 保存编辑器字体家族
const handleSaveEditorFontFamily = async () => {
  try {
    await appearanceStore.setEditorFontFamily(editableEditorFontFamily.value);
    notificationsStore.addNotification({
      type: 'success',
      message: t('styleCustomizer.editorFontFamilySaved'),
    });
  } catch (error: any) {
    console.error('保存编辑器字体失败:', error);
    notificationsStore.addNotification({
      type: 'error',
      message: t('styleCustomizer.editorFontFamilySaveFailed', { message: error.message }),
    });
  }
};
</script>

<template>
  <section>
    <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">
      {{ t('styleCustomizer.otherSettings') }}
    </h3>

    <div
      class="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] items-start md:items-center gap-2 md:gap-3 mb-3"
    >
      <label
        for="editorFontSizeOther"
        class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0"
        >{{ t('styleCustomizer.editorFontSize') }}:</label
      >
      <input
        type="number"
        id="editorFontSizeOther"
        v-model.number="editableEditorFontSize"
        class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground max-w-[100px] justify-self-start box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        min="1"
      />
      <button
        @click="handleSaveEditorFontSize"
        class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap justify-self-start mt-1 md:mt-0"
      >
        {{ t('common.save') }}
      </button>
    </div>

    <hr class="my-4 md:my-6" />

    <div
      class="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] items-start md:items-center gap-2 md:gap-3 mb-3"
    >
      <label
        for="editorFontFamilyOther"
        class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0"
        >{{ t('styleCustomizer.editorFontFamily') }}:</label
      >
      <input
        type="text"
        id="editorFontFamilyOther"
        v-model="editableEditorFontFamily"
        class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        @click="handleSaveEditorFontFamily"
        class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap justify-self-start mt-1 md:mt-0"
      >
        {{ t('common.save') }}
      </button>
    </div>
  </section>
</template>
