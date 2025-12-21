<template>
  <div class="virtual-keyboard-sticky bg-background border-t border-border p-1 pb-2 select-none"> <!-- Added pb-2 for spacing -->
    <!-- Sticky Horizontal Scrollable Row for Essential Keys -->
    <div class="flex overflow-x-auto gap-2 px-2 pb-2 hide-scrollbar items-center">
       <button 
         v-for="key in stickyKeys" 
         :key="key.label"
         @click="handleKeyClick(key)"
         class="flex-shrink-0 min-w-[3rem] h-10 px-2 rounded font-medium text-sm border border-border bg-input text-foreground active:bg-primary active:text-white transition-colors select-none flex items-center justify-center touch-manipulation"
         :class="{'bg-primary text-white': isActiveModifier(key.label)}"
       >
         {{ key.label }}
       </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits({
  (e: 'send-key', sequence: string): void
});

const isCtrlActive = ref(false);
const isAltActive = ref(false);

interface KeyDef {
    label: string;
    sequence?: string;
    isModifier?: boolean;
}

const stickyKeys: KeyDef[] = [
    { label: 'Esc', sequence: '\x1b' },
    { label: 'Tab', sequence: '\t' },
    { label: 'Ctrl', isModifier: true },
    { label: 'Alt', isModifier: true },
    { label: '←', sequence: '\x1b[D' },
    { label: '↓', sequence: '\x1b[B' },
    { label: '↑', sequence: '\x1b[A' },
    { label: '→', sequence: '\x1b[C' },
    { label: '-', sequence: '-' },
    { label: '/', sequence: '/' },
    { label: '|', sequence: '|' },
];

const isActiveModifier = (label: string) => {
    if (label === 'Ctrl') return isCtrlActive.value;
    if (label === 'Alt') return isAltActive.value;
    return false;
};

const handleKeyClick = (key: KeyDef) => {
    if (key.isModifier) {
        if (key.label === 'Ctrl') isCtrlActive.value = !isCtrlActive.value;
        if (key.label === 'Alt') isAltActive.value = !isAltActive.value;
        return; // Don't send
    }

    let sequence = key.sequence || key.label;

    // Apply modifiers
    if (isCtrlActive.value) {
        if (key.label === 'C') sequence = '\x03'; // Ctrl+C
        // Add more ctrl logic if needed
    }
    
    if (isAltActive.value) {
        sequence = '\x1b' + sequence;
    }

    emit('send-key', sequence);
    
    // Auto-release modifiers
    isCtrlActive.value = false;
    isAltActive.value = false;
};
</script>

<style scoped>
.hide-scrollbar::-webkit-scrollbar {
    display: none;
}
.hide-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
/* Touch manipulation adjustment */
.touch-manipulation {
    touch-action: manipulation;
}
</style>