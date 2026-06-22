<template>
  <div id="ai-assistant-panel" class="flex flex-col h-full bg-background border-l border-border">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-header">
      <div class="flex items-center gap-2">
        <i class="fas fa-robot text-primary"></i>
        <span class="font-medium text-sm">{{ t('aiOps.title', 'AI Assistant') }}</span>
        <span v-if="aiStore.currentSessionId" class="text-xs text-text-secondary"
          >({{ truncateSessionId }})</span
        >
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="handleNewSession"
          class="text-text-secondary hover:text-foreground text-xs"
          :title="t('aiOps.newSession', 'New Session')"
          :aria-label="t('aiOps.newSession', 'New Session')"
        >
          <i class="fas fa-plus"></i>
        </button>
        <button
          @click="handleShowHistory"
          class="text-text-secondary hover:text-foreground text-xs"
          :title="t('aiOps.history', 'History')"
          :aria-label="t('aiOps.history', 'History')"
        >
          <i class="fas fa-history"></i>
        </button>
        <button
          @click="$emit('close')"
          class="text-text-secondary hover:text-foreground"
          :title="t('common.close', '关闭')"
          :aria-label="t('common.close', '关闭')"
        >
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <!-- History Panel (Slide-in) -->
    <div v-if="showHistory" class="absolute inset-0 z-10 bg-background flex flex-col">
      <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-header">
        <span class="font-medium text-sm">{{ t('aiOps.sessionHistory', 'Session History') }}</span>
        <button
          @click="showHistory = false"
          class="text-text-secondary hover:text-foreground"
          :title="t('common.back', '返回')"
          :aria-label="t('common.back', '返回')"
        >
          <i class="fas fa-arrow-left"></i>
        </button>
      </div>
      <div class="flex-grow overflow-y-auto custom-scrollbar">
        <div v-if="aiStore.isLoading" class="p-4 text-center text-text-secondary text-sm">
          <i class="fas fa-spinner fa-spin mr-2"></i>{{ t('common.loading', 'Loading...') }}
        </div>
        <div
          v-else-if="aiStore.sessions.length === 0"
          class="p-4 text-center text-text-secondary text-sm"
        >
          {{ t('aiOps.noSessions', 'No previous sessions') }}
        </div>
        <div v-else class="divide-y divide-border">
          <div
            v-for="session in aiStore.sessions"
            :key="session.sessionId"
            class="px-4 py-3 hover:bg-header/50 cursor-pointer flex items-center justify-between group"
            role="button"
            tabindex="0"
            @click="loadSessionHistory(session.sessionId)"
            @keydown.enter="loadSessionHistory(session.sessionId)"
          >
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">
                {{ session.title || t('aiOps.untitled', 'Untitled') }}
              </div>
              <div class="text-xs text-text-secondary">{{ formatDate(session.updatedAt) }}</div>
            </div>
            <button
              @click.stop="deleteSessionHistory(session.sessionId)"
              class="text-text-secondary hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
            >
              <i class="fas fa-trash-alt text-xs"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Chat Area -->
    <div class="flex-grow overflow-y-auto p-4 space-y-4 custom-scrollbar" ref="chatContainer">
      <!-- Empty State -->
      <div
        v-if="aiStore.messages.length === 0 && !aiStore.isLoading"
        class="text-center text-text-secondary text-sm mt-8"
      >
        <i class="fas fa-magic text-2xl mb-2 opacity-50"></i>
        <p>{{ t('aiOps.placeholder', 'Ask me anything about your servers or logs...') }}</p>
        <div class="mt-4 space-y-2">
          <button
            v-for="suggestion in quickSuggestions"
            :key="suggestion.key"
            @click="sendSuggestion(suggestion.query)"
            class="block w-full text-left px-3 py-2 text-xs bg-header border border-border rounded hover:border-primary transition-colors"
          >
            <i :class="['fas mr-2', suggestion.icon]"></i
            >{{ t(suggestion.labelKey, suggestion.label) }}
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div
        v-for="msg in aiStore.messages"
        :key="msg.id"
        :class="[
          'flex flex-col max-w-[85%]',
          msg.role === 'user' ? 'self-end items-end' : 'self-start items-start',
        ]"
      >
        <div
          :class="[
            'px-3 py-2 rounded-lg text-sm whitespace-pre-wrap',
            msg.role === 'user'
              ? 'bg-primary text-white'
              : 'bg-header border border-border text-foreground',
          ]"
          v-html="formatMessage(msg.content)"
        ></div>
        <span class="text-xs text-text-secondary mt-1">{{ formatTime(msg.timestamp) }}</span>
      </div>

      <!-- Typing Indicator -->
      <div
        v-if="aiStore.isTyping"
        class="self-start flex items-center gap-2 text-text-secondary text-xs italic"
      >
        <i class="fas fa-spinner fa-spin"></i>
        {{ t('aiOps.typing', 'AI is analyzing...') }}
      </div>

      <!-- Error Message -->
      <div
        v-if="aiStore.error"
        class="self-center text-error text-xs bg-error/10 px-3 py-2 rounded"
      >
        <i class="fas fa-exclamation-circle mr-1"></i>{{ aiStore.error }}
        <button @click="aiStore.clearError()" class="ml-2 underline">
          {{ t('common.dismiss', 'Dismiss') }}
        </button>
      </div>
    </div>

    <!-- Insights Panel (Collapsible) -->
    <div v-if="aiStore.insights.length > 0" class="border-t border-border">
      <button
        @click="showInsights = !showInsights"
        class="w-full px-4 py-2 text-xs flex items-center justify-between bg-header/30 hover:bg-header/50"
      >
        <span
          ><i class="fas fa-lightbulb mr-2 text-warning"></i
          >{{ t('aiOps.insights', 'Insights') }} ({{ aiStore.insights.length }})</span
        >
        <i :class="['fas', showInsights ? 'fa-chevron-down' : 'fa-chevron-up']"></i>
      </button>
      <div
        v-if="showInsights"
        class="px-4 py-2 space-y-2 max-h-32 overflow-y-auto custom-scrollbar bg-header/20"
      >
        <div
          v-for="(insight, idx) in aiStore.insights"
          :key="idx"
          :class="['text-xs p-2 rounded border-l-2', severityClass(insight.severity)]"
        >
          <div class="font-medium">{{ insight.title }}</div>
          <div class="text-text-secondary">{{ insight.description }}</div>
          <div v-if="insight.suggestedAction" class="mt-1 text-primary">
            <i class="fas fa-hand-point-right mr-1"></i>{{ insight.suggestedAction }}
          </div>
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div class="p-4 border-t border-border bg-header/30">
      <div class="flex gap-2">
        <input
          v-model="inputMessage"
          @keydown.enter="sendMessage"
          type="text"
          aria-label="发送消息"
          class="flex-grow px-3 py-2 text-sm bg-input border border-border rounded focus:outline-none focus:border-primary text-foreground"
          :placeholder="t('aiOps.inputPlaceholder', 'Type a message...')"
          :disabled="aiStore.isTyping"
        />
        <button
          @click="sendMessage"
          :disabled="!inputMessage.trim() || aiStore.isTyping"
          class="px-3 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
          :title="t('aiOps.sendMessage', '发送消息')"
          :aria-label="t('aiOps.sendMessage', '发送消息')"
        >
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
      <!-- Suggestions -->
      <div v-if="aiStore.suggestions.length > 0" class="mt-2 flex flex-wrap gap-1">
        <button
          v-for="(sug, idx) in aiStore.suggestions.slice(0, 3)"
          :key="idx"
          @click="sendSuggestion(sug)"
          class="text-xs px-2 py-1 bg-header border border-border rounded hover:border-primary transition-colors"
        >
          {{ sug }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DOMPurify from 'dompurify';
import { useAIStore } from '../../stores/ai.store';
import type { AIInsightSeverity } from '../../types/ai.types';

const { t } = useI18n();
const emit = defineEmits(['close']);

const aiStore = useAIStore();
const inputMessage = ref('');
const chatContainer = ref<HTMLElement | null>(null);
const showHistory = ref(false);
const showInsights = ref(false);

// 快速建议
const quickSuggestions = [
  {
    key: 'health',
    query: '系统健康状态如何？',
    icon: 'fa-heartbeat',
    labelKey: 'aiOps.suggestions.health',
    label: 'Check System Health',
  },
  {
    key: 'commands',
    query: '分析最近的命令执行模式',
    icon: 'fa-terminal',
    labelKey: 'aiOps.suggestions.commands',
    label: 'Analyze Command Patterns',
  },
  {
    key: 'security',
    query: '查看安全事件统计',
    icon: 'fa-shield-alt',
    labelKey: 'aiOps.suggestions.security',
    label: 'View Security Events',
  },
  {
    key: 'connections',
    query: '连接使用情况怎样？',
    icon: 'fa-network-wired',
    labelKey: 'aiOps.suggestions.connections',
    label: 'Connection Status',
  },
];

// 截断会话 ID 显示
const truncateSessionId = computed(() => {
  if (!aiStore.currentSessionId) return '';
  return aiStore.currentSessionId.substring(0, 8) + '...';
});

// 格式化时间
const formatTime = (ts: Date | string | number) => {
  const date = ts instanceof Date ? ts : new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// 格式化日期
const formatDate = (ts: Date | string | number) => {
  const date = ts instanceof Date ? ts : new Date(ts);
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 格式化消息（支持 Markdown 基础格式，使用 DOMPurify 防止 XSS）
const formatMessage = (content: string) => {
  // 先转义 HTML 实体，再应用 Markdown 格式化
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const formatted = escaped
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-background px-1 rounded text-xs">$1</code>')
    .replace(/^### (.+)$/gm, '<div class="font-bold text-base mt-2 mb-1">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="font-bold text-lg mt-3 mb-2">$1</div>')
    .replace(/^- (.+)$/gm, '<div class="ml-2">• $1</div>')
    .replace(/^\d+\. (.+)$/gm, '<div class="ml-2">$&</div>')
    .replace(/\n/g, '<br/>');

  // 使用 DOMPurify 消毒，仅允许安全的 HTML 标签和属性
  return DOMPurify.sanitize(formatted, {
    ALLOWED_TAGS: ['strong', 'code', 'div', 'br'],
    ALLOWED_ATTR: ['class'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });
};

// 严重程度样式
const severityClass = (severity: AIInsightSeverity) => {
  const classes: Record<AIInsightSeverity, string> = {
    info: 'border-primary bg-primary/10',
    low: 'border-success bg-success/10',
    medium: 'border-warning bg-warning/10',
    high: 'border-warning bg-warning/10',
    critical: 'border-error bg-error/10',
  };
  return classes[severity] || classes.info;
};

// 滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
};

// 发送消息
const sendMessage = async () => {
  if (!inputMessage.value.trim() || aiStore.isTyping) return;

  const query = inputMessage.value;
  inputMessage.value = '';

  await aiStore.sendQuery(query);
  scrollToBottom();
};

// 发送建议
const sendSuggestion = async (suggestion: string) => {
  inputMessage.value = suggestion;
  await sendMessage();
};

// 新建会话
const handleNewSession = () => {
  aiStore.startNewSession();
};

// 显示历史
const handleShowHistory = async () => {
  showHistory.value = true;
  await aiStore.fetchSessions();
};

// 加载历史会话
const loadSessionHistory = async (sessionId: string) => {
  await aiStore.loadSession(sessionId);
  showHistory.value = false;
  scrollToBottom();
};

// 删除历史会话
const deleteSessionHistory = async (sessionId: string) => {
  await aiStore.deleteSession(sessionId);
};

// 监听消息变化自动滚动
watch(
  () => aiStore.messages.length,
  () => {
    scrollToBottom();
  },
);

// 组件挂载
onMounted(() => {
  // 如果有活跃会话，滚动到底部
  if (aiStore.messages.length > 0) {
    scrollToBottom();
  }
});
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}
</style>
