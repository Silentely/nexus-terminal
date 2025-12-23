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
  <div class="tags-view">
    <h2>{{ t('tags.title') }}</h2>

    <div class="actions-bar">
      <button @click="openAddForm">{{ t('tags.addTag') }}</button>
    </div>

    <div v-if="tagsStore.isLoading" class="loading-message">
      {{ t('tags.loading') }}
    </div>
    <div v-else-if="tagsStore.error" class="error-message">
      {{ t('tags.error', { error: tagsStore.error }) }}
    </div>
    <div v-else-if="tagsStore.tags.length === 0" class="no-data-message">
      {{ t('tags.noTags') }}
    </div>
    <TagList v-else :tags="tagsStore.tags" @edit-tag="openEditForm" />

    <!-- 添加/编辑标签表单 (模态框) -->
    <AddTagForm
      v-if="showAddTagForm"
      :tag-to-edit="tagToEdit"
      @close="closeForm"
      @tag-saved="onTagSaved"
    />
  </div>
</template>

<style scoped>
.tags-view {
  padding: 1rem;
}

h2 {
  margin-bottom: 1rem;
}

.actions-bar {
  margin-bottom: 1rem;
}

.actions-bar button {
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.loading-message,
.error-message,
.no-data-message {
  margin-top: 1rem;
  text-align: center;
  color: #666;
}

.error-message {
  color: red;
}
</style>
