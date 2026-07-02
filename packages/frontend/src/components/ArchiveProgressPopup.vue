<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ArchiveProgressState } from '../types/sftp.types';

const props = defineProps<{
  progress: ArchiveProgressState;
}>();

const { t } = useI18n();

const operationLabel = computed(() => {
  if (props.progress.operation === 'compress') return t('fileManager.contextMenu.compress');
  if (props.progress.operation === 'decompress') return t('fileManager.contextMenu.decompress');
  return '';
});

const displayFileName = computed(() => {
  if (!props.progress.currentFile) return null;
  // 文件名过长时截断显示，保留开头（含目录路径和文件名前缀）
  const name = props.progress.currentFile;
  return name.length > 40 ? name.slice(0, 37) + '...' : name;
});
</script>

<template>
  <Transition name="archive-progress">
    <div
      v-if="progress.active"
      class="fixed bottom-4 left-4 bg-background border border-border rounded-md shadow-md p-3 max-w-sm z-[1001] text-sm"
    >
      <div class="flex items-center gap-2 mb-1.5">
        <span class="animate-spin text-base">⚙️</span>
        <span class="font-semibold">
          {{ operationLabel }} {{ progress.archiveName || '...' }}
        </span>
      </div>
      <div class="text-xs text-muted-foreground space-y-0.5">
        <div v-if="progress.fileCount > 0">
          {{ t('fileManager.archiveProgress.filesProcessed', { count: progress.fileCount }) }}
        </div>
        <div v-if="displayFileName" class="truncate" :title="progress.currentFile || ''">
          {{ displayFileName }}
        </div>
        <div
          v-if="progress.fileCount === 0 && !progress.currentFile"
          class="text-muted-foreground italic"
        >
          {{ t('fileManager.archiveProgress.starting') }}
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.archive-progress-enter-active,
.archive-progress-leave-active {
  transition: all 0.3s ease;
}
.archive-progress-enter-from,
.archive-progress-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
