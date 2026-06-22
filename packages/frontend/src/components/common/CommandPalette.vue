<template>
  <Transition name="fade">
    <div
      v-if="isVisible"
      class="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      @click.self="close"
    >
      <div class="fixed inset-0 bg-black/50" aria-hidden="true"></div>
      <div
        class="relative w-full max-w-2xl mx-4 bg-[var(--editor-header-bg-color)] rounded-lg shadow-2xl border border-[var(--editor-border-color)] overflow-hidden flex flex-col max-h-[60vh]"
      >
        <!-- Search Input -->
        <div class="flex items-center px-4 py-3 border-b border-[var(--editor-border-color)]">
          <i class="fas fa-search text-text-secondary mr-3"></i>
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="w-full bg-transparent border-none text-white focus:ring-0 placeholder-text-secondary text-lg outline-none"
            :placeholder="t('commandPalette.placeholder', 'Type a command or search...')"
            @keydown="handleKeydown"
          />
          <div class="flex items-center gap-2 text-xs text-text-secondary">
            <span
              class="px-1.5 py-0.5 rounded border border-[var(--editor-input-bg-color)] bg-[var(--editor-bg-color)]"
              >ESC</span
            >
          </div>
        </div>

        <!-- Results List -->
        <div class="overflow-y-auto custom-scrollbar flex-grow">
          <div v-if="filteredItems.length === 0" class="px-4 py-8 text-center text-text-secondary">
            {{ t('commandPalette.noResults', 'No matching commands found') }}
          </div>
          <div v-else class="py-2">
            <div
              v-for="(item, index) in filteredItems"
              :key="item.id"
              role="option"
              :aria-selected="selectedIndex === index"
              tabindex="0"
              :class="[
                'px-4 py-2 cursor-pointer flex items-center justify-between group',
                {
                  'bg-[var(--link-active-bg-color)]': selectedIndex === index,
                  'hover:bg-[var(--editor-bg-color)]': selectedIndex !== index,
                },
              ]"
              @click="execute(item)"
              @keydown.enter="execute(item)"
              @mouseover="selectedIndex = index"
            >
              <div class="flex items-center gap-3">
                <i
                  :class="[
                    item.icon,
                    'w-5 text-center',
                    selectedIndex === index ? 'text-white' : 'text-[var(--editor-text-color)]',
                  ]"
                ></i>
                <span
                  :class="
                    selectedIndex === index ? 'text-white' : 'text-[var(--editor-text-color)]'
                  "
                  >{{ item.label }}</span
                >
              </div>
              <span v-if="item.shortcut" class="text-xs text-text-secondary font-mono">{{
                item.shortcut
              }}</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div
          class="px-4 py-1.5 bg-[var(--editor-header-bg-color)] border-t border-[var(--editor-border-color)] text-xs text-text-secondary flex justify-end gap-4"
        >
          <span><span class="text-foreground">↑↓</span> {{ t('common.navigate') }}</span>
          <span><span class="text-foreground">↵</span> {{ t('common.select') }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useMagicKeys, whenever } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
// Import stores to execute actions
import { useSessionStore } from '../../stores/session.store';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useConnectionsStore } from '../../stores/connections.store';
import { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import { log } from '@/utils/log';

const { t } = useI18n();
const router = useRouter();
const sessionStore = useSessionStore();
const appearanceStore = useAppearanceStore();
const connectionsStore = useConnectionsStore();
const uiNotificationsStore = useUiNotificationsStore();

interface CommandItem {
  id: string;
  label: string;
  icon: string;
  action: () => unknown;
  category: string;
  shortcut?: string;
}

const isVisible = ref(false);
const query = ref('');
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const { Meta_K, Ctrl_K, Escape } = useMagicKeys();

whenever(
  () => Meta_K.value || Ctrl_K.value,
  () => {
    open();
  },
);

whenever(Escape, () => {
  if (isVisible.value) close();
});

const open = () => {
  isVisible.value = true;
  query.value = '';
  selectedIndex.value = 0;
  // Focus input on next tick
  setTimeout(() => inputRef.value?.focus(), 50);
};

const close = () => {
  isVisible.value = false;
};

// --- Mock Data / Real Actions ---
// In a real app, this would be computed from stores dynamically
const allItems = computed<CommandItem[]>(() => {
  const items: CommandItem[] = [
    {
      id: 'theme-dark',
      label: 'Theme: Dark',
      icon: 'fas fa-moon',
      action: () => appearanceStore.setTheme('dark'),
      category: 'Appearance',
    },
    {
      id: 'theme-light',
      label: 'Theme: Light',
      icon: 'fas fa-sun',
      action: () => appearanceStore.setTheme('light'),
      category: 'Appearance',
    },
    {
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      icon: 'fas fa-home',
      action: () => router.push('/'),
      category: 'Navigation',
    },
    {
      id: 'nav-connections',
      label: 'Go to Connections',
      icon: 'fas fa-network-wired',
      action: () => router.push('/connections'),
      category: 'Navigation',
    },
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      icon: 'fas fa-cog',
      action: () => router.push('/settings'),
      category: 'Navigation',
    },
  ];

  // Add Connections
  connectionsStore.connections.forEach((conn) => {
    items.push({
      id: `conn-${conn.id}`,
      label: `Connect to ${conn.name} (${conn.host})`,
      icon: 'fas fa-terminal',
      action: () => {
        sessionStore.handleConnectRequest(conn);
        router.push('/workspace');
      },
      category: 'Connections',
    });
  });

  return items;
});

const filteredItems = computed(() => {
  if (!query.value) return allItems.value.slice(0, 10); // Default show 10
  const lowerQuery = query.value.toLowerCase();
  return allItems.value
    .filter((item) => item.label.toLowerCase().includes(lowerQuery))
    .slice(0, 50);
});

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value =
      (selectedIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredItems.value[selectedIndex.value]) {
      execute(filteredItems.value[selectedIndex.value]);
    }
  }
};

const execute = (item: CommandItem) => {
  Promise.resolve()
    .then(() => item.action())
    .catch((error) => {
      log.error('[CommandPalette] 执行命令失败:', error);
      uiNotificationsStore.showError(t('commandPalette.actionFailed', '执行失败，请稍后重试'));
    })
    .finally(() => {
      close();
    });
};

watch(query, () => {
  selectedIndex.value = 0;
});
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--editor-input-bg-color);
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--editor-border-color);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
