<template>
  <Transition name="fade">
    <div v-if="isVisible" class="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]" @click.self="close">
      <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true"></div>
      <div class="relative w-full max-w-2xl mx-4 bg-[#1e1e1e] rounded-lg shadow-2xl border border-[#333] overflow-hidden flex flex-col max-h-[60vh]">
        <!-- Search Input -->
        <div class="flex items-center px-4 py-3 border-b border-[#333]">
          <i class="fas fa-search text-gray-400 mr-3"></i>
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="w-full bg-transparent border-none text-white focus:ring-0 placeholder-gray-500 text-lg outline-none"
            :placeholder="t('commandPalette.placeholder', 'Type a command or search...')"
            @keydown="handleKeydown"
          />
          <div class="flex items-center gap-2 text-xs text-gray-500">
             <span class="px-1.5 py-0.5 rounded border border-[#444] bg-[#2d2d2d]">ESC</span>
          </div>
        </div>

        <!-- Results List -->
        <div class="overflow-y-auto custom-scrollbar flex-grow">
           <div v-if="filteredItems.length === 0" class="px-4 py-8 text-center text-gray-500">
             {{ t('commandPalette.noResults', 'No matching commands found') }}
           </div>
           <div v-else class="py-2">
             <div
               v-for="(item, index) in filteredItems"
               :key="item.id"
               :class="['px-4 py-2 cursor-pointer flex items-center justify-between group', { 'bg-[#04395e]': selectedIndex === index, 'hover:bg-[#2d2d2d]': selectedIndex !== index }]"
               @click="execute(item)"
               @mouseover="selectedIndex = index"
             >
               <div class="flex items-center gap-3">
                 <i :class="[item.icon, 'w-5 text-center', selectedIndex === index ? 'text-white' : 'text-gray-400']"></i>
                 <span :class="selectedIndex === index ? 'text-white' : 'text-gray-300'">{{ item.label }}</span>
               </div>
               <span v-if="item.shortcut" class="text-xs text-gray-500 font-mono">{{ item.shortcut }}</span>
             </div>
           </div>
        </div>
        
        <!-- Footer -->
        <div class="px-4 py-1.5 bg-[#252526] border-t border-[#333] text-xs text-gray-500 flex justify-end gap-4">
           <span><span class="text-gray-300">↑↓</span> {{ t('common.navigate') }}</span>
           <span><span class="text-gray-300">↵</span> {{ t('common.select') }}</span>
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

const { t } = useI18n();
const router = useRouter();
const sessionStore = useSessionStore();
const appearanceStore = useAppearanceStore();
const connectionsStore = useConnectionsStore();

const isVisible = ref(false);
const query = ref('');
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const { Meta_K, Ctrl_K, Escape } = useMagicKeys();

whenever(() => Meta_K.value || Ctrl_K.value, () => {
  open();
});

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
const allItems = computed(() => {
  const items = [
    { id: 'theme-dark', label: 'Theme: Dark', icon: 'fas fa-moon', action: () => appearanceStore.setTheme('dark'), category: 'Appearance' },
    { id: 'theme-light', label: 'Theme: Light', icon: 'fas fa-sun', action: () => appearanceStore.setTheme('light'), category: 'Appearance' },
    { id: 'nav-dashboard', label: 'Go to Dashboard', icon: 'fas fa-home', action: () => router.push('/'), category: 'Navigation' },
    { id: 'nav-connections', label: 'Go to Connections', icon: 'fas fa-network-wired', action: () => router.push('/connections'), category: 'Navigation' },
    { id: 'nav-settings', label: 'Go to Settings', icon: 'fas fa-cog', action: () => router.push('/settings'), category: 'Navigation' },
  ];

  // Add Connections
  connectionsStore.connections.forEach(conn => {
    items.push({
        id: `conn-${conn.id}`,
        label: `Connect to ${conn.name} (${conn.host})`,
        icon: 'fas fa-terminal',
        action: () => {
            sessionStore.handleConnectRequest(conn);
            router.push('/workspace');
        },
        category: 'Connections'
    });
  });

  return items;
});

const filteredItems = computed(() => {
  if (!query.value) return allItems.value.slice(0, 10); // Default show 10
  const lowerQuery = query.value.toLowerCase();
  return allItems.value.filter(item => 
    item.label.toLowerCase().includes(lowerQuery)
  ).slice(0, 50);
});

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredItems.value[selectedIndex.value]) {
        execute(filteredItems.value[selectedIndex.value]);
    }
  }
};

const execute = (item: any) => {
  item.action();
  close();
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
  background: #444;
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #555;
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
