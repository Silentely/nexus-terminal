<template>
  <li
    class="session-item p-3 mb-2 border border-border/70 rounded-md bg-surface-ground"
    :class="{ 'opacity-60': session.backendSshStatus === 'disconnected_by_backend' }"
  >
    <div class="flex justify-between items-center">
      <div class="session-info flex-grow mr-2">
        <!-- 会话名称与状态 -->
        <div class="font-bold text-lg flex items-center">
          <span
            v-if="!isEditing"
            class="cursor-pointer hover:text-primary"
            :title="$t('suspendedSshSessions.tooltip.editName')"
            @click="$emit('start-edit', session)"
          >
            {{ session.customSuspendName || session.connectionName }}
          </span>
          <input
            v-else
            ref="nameInputRef"
            v-model="editValue"
            type="text"
            class="text-lg font-bold w-full px-1 py-0.5 border border-primary rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            @blur="$emit('finish-edit', editValue)"
            @keydown.enter.prevent="$emit('finish-edit', editValue)"
            @keydown.esc.prevent="$emit('cancel-edit')"
          />
          <span
            :class="[
              'px-2 py-0.5 text-xs font-semibold rounded-full ml-2 whitespace-nowrap',
              session.backendSshStatus === 'hanging'
                ? 'bg-success/20 text-success'
                : 'bg-warning/20 text-warning',
            ]"
          >
            {{
              session.backendSshStatus === 'hanging'
                ? $t('suspendedSshSessions.status.hanging')
                : $t('suspendedSshSessions.status.disconnected')
            }}
          </span>
        </div>

        <!-- 连接信息 -->
        <div class="text-sm text-muted-color">
          {{ $t('suspendedSshSessions.label.originalConnection') }}:
          {{ session.connectionName }}
        </div>
        <div class="text-xs text-muted-color mt-1">
          {{ $t('suspendedSshSessions.label.suspendedAt') }}:
          {{ formatDateTime(session.suspendStartTime) }}
        </div>
        <div
          v-if="
            session.backendSshStatus === 'disconnected_by_backend' && session.disconnectionTimestamp
          "
          class="text-xs text-warning mt-1"
        >
          {{
            $t('suspendedSshSessions.disconnectedAt', {
              time: formatDateTime(session.disconnectionTimestamp),
            })
          }}
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="session-status-actions flex flex-col items-end">
        <div class="actions flex flex-col space-y-2 mt-1">
          <button
            v-if="session.backendSshStatus === 'hanging'"
            @click="$emit('resume', session)"
            :title="$t('suspendedSshSessions.action.resume')"
            class="responsive-button-padding py-1.5 text-sm font-medium rounded-md text-button-text bg-button hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-150 inline-flex items-center"
          >
            <i class="fas fa-play action-icon" style="color: var(--button-text-color, white)"></i>
            <span class="button-session-text">{{ $t('suspendedSshSessions.action.resume') }}</span>
          </button>
          <button
            @click="$emit('remove', session)"
            :title="$t('suspendedSshSessions.action.remove')"
            class="responsive-button-padding py-1.5 text-sm font-medium rounded-md text-error-text bg-error hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error transition-colors duration-150 inline-flex items-center"
          >
            <i class="fas fa-trash-alt action-icon text-white"></i>
            <span class="button-session-text">{{ $t('suspendedSshSessions.action.remove') }}</span>
          </button>
          <button
            v-if="
              session.backendSshStatus === 'disconnected_by_backend' ||
              session.backendSshStatus === 'hanging'
            "
            @click="$emit('export-log', session)"
            :title="$t('suspendedSshSessions.action.exportLog')"
            class="responsive-button-padding py-1.5 text-sm font-medium rounded-md text-button-text bg-primary hover:bg-primary/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-150 inline-flex items-center"
          >
            <i
              class="fas fa-download action-icon"
              style="color: var(--button-text-color, white)"
            ></i>
            <span class="button-session-text">{{
              $t('suspendedSshSessions.action.exportLog')
            }}</span>
          </button>
        </div>
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { SuspendedSshSession } from '../types/ssh-suspend.types';

const props = defineProps<{
  session: SuspendedSshSession;
  isEditing: boolean;
}>();

defineEmits<{
  'start-edit': [session: SuspendedSshSession];
  'finish-edit': [name: string];
  'cancel-edit': [];
  resume: [session: SuspendedSshSession];
  remove: [session: SuspendedSshSession];
  'export-log': [session: SuspendedSshSession];
}>();

const editValue = ref(props.session.customSuspendName || props.session.connectionName);
const nameInputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.isEditing,
  async (editing) => {
    if (editing) {
      editValue.value = props.session.customSuspendName || props.session.connectionName;
      await nextTick();
      nameInputRef.value?.focus();
    }
  },
);

const formatDateTime = (isoString?: string) => {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
};
</script>
