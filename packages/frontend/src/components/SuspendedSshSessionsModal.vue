<script setup lang="ts">
import { defineProps, defineEmits, watch, onMounted, onUnmounted } from 'vue';
import SuspendedSshSessionsView from '../views/SuspendedSshSessionsView.vue'; // 导入视图
import { useWorkspaceEventSubscriber, useWorkspaceEventOff } from '../composables/workspaceEvents'; // 导入事件订阅器和取消订阅器
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  isVisible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();

const closeModal = () => {
  emit('close');
};

// 键盘监听 Esc 关闭
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeModal();
  }
};

watch(
  () => props.isVisible,
  (newValue) => {
    if (newValue) {
      document.addEventListener('keydown', handleKeydown);
    } else {
      document.removeEventListener('keydown', handleKeydown);
    }
  }
);

const onWorkspaceEvent = useWorkspaceEventSubscriber();
const offWorkspaceEvent = useWorkspaceEventOff(); // 获取取消订阅函数

// 定义事件处理函数
const handleSuspendedSessionActionCompleted = () => {
  console.log(
    '[SuspendedSshSessionsModal] Received suspendedSession:actionCompleted event, closing modal.'
  );
  closeModal();
};

onMounted(() => {
  // 监听 suspendedSession:actionCompleted 事件以关闭模态框
  onWorkspaceEvent('suspendedSession:actionCompleted', handleSuspendedSessionActionCompleted);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  // 组件卸载时取消订阅
  offWorkspaceEvent('suspendedSession:actionCompleted', handleSuspendedSessionActionCompleted);
});
</script>

<template>
  <div
    v-if="isVisible"
    class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4"
    @click.self="closeModal"
  >
    <div
      class="bg-background text-foreground p-4 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[85vh] flex flex-col relative"
    >
      <!-- Close Button -->
      <button
        class="absolute top-2 right-2 p-1 text-text-secondary hover:text-foreground z-10"
        @click="closeModal"
        :title="t('close', '关闭')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <!-- Title -->
      <h3 class="text-lg font-semibold text-center mb-3 flex-shrink-0">
        {{ t('suspendedSshSessions.modalTitle', '挂起的 SSH 会话') }}
      </h3>
      <!-- Suspended SSH Sessions View Embedded -->
      <div class="flex-grow overflow-y-auto border border-border rounded">
        <SuspendedSshSessionsView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.bg-overlay {
  background-color: rgba(0, 0, 0, 0.6);
}
</style>
