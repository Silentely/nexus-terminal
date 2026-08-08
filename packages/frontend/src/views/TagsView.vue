<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTagsStore, TagInfo } from '../stores/tags.store';

const { t } = useI18n();
const tagsStore = useTagsStore();

const showAddTagForm = ref(false);
const tagToEdit = ref<TagInfo | null>(null);

// 组件挂载时获取标签列表
onMounted(() => {
  tagsStore.fetchTags();
});

// 打开添加表单
const openAddForm = () => {
  tagToEdit.value = null; // 确保不是编辑模式
  showAddTagForm.value = true;
};

// 打开编辑表单
const openEditForm = (tag: TagInfo) => {
  tagToEdit.value = tag;
  showAddTagForm.value = true;
};

// 关闭表单
const closeForm = () => {
  showAddTagForm.value = false;
  tagToEdit.value = null;
};

// 处理标签添加/更新成功事件
const onTagSaved = () => {
  closeForm();
  // Store 内部会自动刷新列表，这里无需额外操作
};
</script>

<template>
  <div class="p-4 md:p-6 bg-background text-foreground">
    <div class="max-w-screen-lg mx-auto">
      <h2 class="text-xl font-semibold text-foreground mb-4">{{ t('tags.title') }}</h2>

      <div class="mb-4">
        <button
          @click="openAddForm"
          class="px-4 py-2 bg-primary text-white border-none rounded-lg text-sm font-semibold cursor-pointer shadow-md transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
        >
          {{ t('tags.addTag') }}
        </button>
      </div>

      <LoadingState v-if="tagsStore.isLoading" :text="t('tags.loading')" compact />
      <ErrorBanner
        v-else-if="tagsStore.error"
        :message="t('tags.error', { error: tagsStore.error })"
      />
      <EmptyState v-else-if="tagsStore.tags.length === 0" :text="t('tags.noTags')" icon="fa-tags" />
      <TagList v-else :tags="tagsStore.tags" @edit-tag="openEditForm" />

      <!-- 添加/编辑标签表单 (模态框) -->
      <AddTagForm
        v-if="showAddTagForm"
        :tag-to-edit="tagToEdit"
        @close="closeForm"
        @tag-saved="onTagSaved"
      />
    </div>
  </div>
</template>
