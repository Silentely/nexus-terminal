<script setup lang="ts">
import { ref, computed, onMounted, watch, onBeforeUnmount, nextTick, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFavoritePathsStore, type FavoritePathItem } from '../stores/favoritePaths.store';
import { useSessionStore } from '../stores/session.store';
import AddEditFavoritePathForm from './AddEditFavoritePathForm.vue';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents';
import { useConfirmDialog } from '../composables/useConfirmDialog';

const PADDING = 8; // px

const props = defineProps({
  isVisible: {
    type: Boolean,
    required: true,
  },
  triggerElement: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
});

const emit = defineEmits(['close', 'navigateToPath']);

const { t } = useI18n();
const favoritePathsStore = useFavoritePathsStore();
const sessionStore = useSessionStore();
const emitWorkspaceEvent = useWorkspaceEventEmitter();
const { showConfirmDialog } = useConfirmDialog();

const searchTerm = ref('');
const showAddEditModal = ref(false);
const editingPathItem = ref<FavoritePathItem | null>(null);
const modalContentRef = ref<HTMLElement | null>(null);
const modalStyle = ref<Record<string, string>>({});

const filteredPaths = computed(() => {
  if (!searchTerm.value) {
    return favoritePathsStore.favoritePaths;
  }
  const lowerSearchTerm = searchTerm.value.toLowerCase();
  return favoritePathsStore.favoritePaths.filter(
    (p) =>
      p.path.toLowerCase().includes(lowerSearchTerm) ||
      (p.name && p.name.toLowerCase().includes(lowerSearchTerm))
  );
});

// Computed property for sort button icon and title
const currentSortBy = computed(() => favoritePathsStore.currentSortBy);

const sortButtonIcon = computed(() => {
  return currentSortBy.value === 'name' ? 'fas fa-sort-alpha-down' : 'fas fa-clock';
});

const toggleSort = () => {
  const newSortBy = currentSortBy.value === 'name' ? 'last_used_at' : 'name';
  favoritePathsStore.setSortBy(newSortBy);
};

const handleItemClick = async (pathItem: FavoritePathItem) => {
  try {
    // Mark path as used before navigating
    await favoritePathsStore.markPathAsUsed(pathItem.id, t);
  } catch (error) {
    console.error('Failed to mark path as used:', error);
    // Optionally, inform the user about the failure, though navigation will still proceed.
  }
  emit('navigateToPath', pathItem.path);
  closeModal();
};

const openAddModal = () => {
  editingPathItem.value = null;
  showAddEditModal.value = true;
};

const openEditModal = (pathItem: FavoritePathItem) => {
  editingPathItem.value = { ...pathItem };
  showAddEditModal.value = true;
};

const handleDelete = async (pathItem: FavoritePathItem) => {
  const confirmed = await showConfirmDialog({
    message: t('favoritePaths.confirmDelete', { name: pathItem.name || pathItem.path }),
  });
  if (confirmed) {
    try {
      await favoritePathsStore.deleteFavoritePath(pathItem.id, t);
    } catch (error) {
      console.error('Failed to delete favorite path from modal:', error);
    }
  }
};

const handleSendToTerminal = (pathItem: FavoritePathItem) => {
  const activeSession = sessionStore.activeSession;
  if (activeSession && activeSession.terminalManager) {
    const escapedPath = `"${pathItem.path.replace(/"/g, '\\"')}"`;
    const command = `cd ${escapedPath}\n`;
    try {
      activeSession.terminalManager.sendData(command);
    } catch (error) {
      console.error('[FavoritePathsModal] Failed to send command to active terminal:', error);
    }
  } else {
    console.warn(
      '[FavoritePathsModal] No active session with a terminal manager found to send path to.'
    );
  }
  closeModal();
};

const closeModal = () => {
  emit('close');
};

const updatePosition = () => {
  if (!props.isVisible || !props.triggerElement || !modalContentRef.value) {
    return;
  }

  const triggerRect = props.triggerElement.getBoundingClientRect();
  const modalWidth = modalContentRef.value.offsetWidth;
  const modalHeight = modalContentRef.value.offsetHeight;

  // If dimensions are zero when modal is supposed to be visible,
  // it might mean content affecting size isn't ready. Retry once.
  if (modalWidth === 0 && modalHeight === 0 && props.isVisible) {
    nextTick(updatePosition);
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = triggerRect.bottom + 2; // Default position below trigger, with a small 2px gap
  let left = triggerRect.left;

  // Check for bottom overflow
  if (top + modalHeight + PADDING > viewportHeight) {
    // Try to position above the trigger
    top = triggerRect.top - modalHeight - 2; // Position above trigger, with a small 2px gap
  }

  // If positioning above also causes top overflow (e.g., trigger is near the top and modal is tall)
  if (top < PADDING) {
    top = PADDING; // Align to viewport top with padding
    // Note: If modalHeight is still greater than viewportHeight - 2*PADDING,
    // it will overflow downwards. The `max-h-80` class on the modal
    // should generally prevent the modal itself from being excessively tall.
  }

  // Check for right overflow
  if (left + modalWidth + PADDING > viewportWidth) {
    left = viewportWidth - modalWidth - PADDING; // Align to viewport right edge
  }

  // Check for left overflow (less likely with initial left alignment to trigger, but good for robustness)
  if (left < PADDING) {
    left = PADDING; // Align to viewport left edge
  }

  modalStyle.value = {
    position: 'fixed', // Position relative to the viewport
    top: `${top}px`,
    left: `${left}px`,
  };
};

// --- Click Outside Logic ---
const handleClickOutside = (event: MouseEvent) => {
  if (props.triggerElement && props.triggerElement.contains(event.target as Node)) {
    return;
  }

  if (modalContentRef.value && !modalContentRef.value.contains(event.target as Node)) {
    if (!showAddEditModal.value) {
      closeModal();
    }
  }
};

watch(
  () => props.isVisible,
  (newValue: boolean) => {
    if (newValue) {
      searchTerm.value = '';
      document.addEventListener('mousedown', handleClickOutside);
      nextTick(() => {
        // Ensure DOM is ready for measurements
        updatePosition(); // Calculate initial position
        window.addEventListener('resize', updatePosition); // Adjust position on window resize
      });
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePosition); // Clean up resize listener
    }
  }
);

onMounted(() => {
  if (props.isVisible) {
    searchTerm.value = '';
    document.addEventListener('mousedown', handleClickOutside);
    nextTick(() => {
      updatePosition();
      window.addEventListener('resize', updatePosition);
    });
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside);
  window.removeEventListener('resize', updatePosition); // Ensure resize listener is cleaned up
});
</script>

<template>
  <!-- New single root element -->
  <div>
    <!-- Favorite Paths Dropdown -->
    <div
      v-if="isVisible"
      ref="modalContentRef"
      :style="modalStyle"
      class="z-50 w-72 md:w-80 rounded-md bg-background shadow-lg border border-border/50 max-h-80 flex flex-col overflow-hidden"
    >
      <!-- Toolbar: Search and Add Button -->
      <div class="p-2 flex-shrink-0 flex items-center gap-2">
        <div class="relative flex-grow">
          <input
            type="text"
            v-model="searchTerm"
            :placeholder="t('favoritePaths.searchPlaceholder', 'Search by name or path...')"
            class="w-full bg-input border border-border rounded-md pl-2.5 pr-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          />
        </div>
        <button
          @click="toggleSort"
          class="flex items-center justify-center w-8 h-8 bg-background border border-border text-text-secondary rounded-lg text-sm cursor-pointer shadow-sm transition-colors duration-200 ease-in-out hover:bg-primary/10 hover:text-primary focus:outline-none flex-shrink-0"
        >
          <i :class="sortButtonIcon"></i>
        </button>
        <button
          @click="openAddModal"
          class="flex items-center justify-center w-8 h-8 bg-primary text-white border-none rounded-lg text-sm font-semibold cursor-pointer shadow-md transition-colors duration-200 ease-in-out hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary flex-shrink-0"
          :title="t('favoritePaths.addNew', 'Add new favorite path')"
        >
          <i class="fas fa-plus text-base"></i>
        </button>
      </div>

      <!-- Path List -->
      <div class="overflow-y-auto flex-grow p-1 text-sm">
        <div
          v-if="favoritePathsStore.isLoading && filteredPaths.length === 0"
          class="p-3 text-center text-text-secondary"
        >
          <i class="fas fa-spinner fa-spin mr-1"></i>
          {{ t('favoritePaths.loading', 'Loading favorites...') }}
        </div>
        <div
          v-else-if="!favoritePathsStore.isLoading && filteredPaths.length === 0"
          class="p-3 text-center text-text-secondary"
        >
          <i class="fas fa-star-half-alt mr-1"></i>
          {{
            searchTerm
              ? t('favoritePaths.noResults', 'No matching favorites found.')
              : t('favoritePaths.noFavorites', 'No favorite paths yet. Add one!')
          }}
        </div>
        <ul v-else-if="filteredPaths.length > 0" class="list-none m-0 p-0">
          <li
            v-for="favPath in filteredPaths"
            :key="favPath.id"
            class="p-2 hover:bg-primary/10 cursor-pointer group flex items-center justify-between rounded-md transition-colors duration-150"
            @click="handleItemClick(favPath)"
            :title="favPath.path"
          >
            <div class="flex-grow overflow-hidden mr-2">
              <p class="font-medium truncate text-foreground">
                {{ favPath.name || favPath.path }}
              </p>
              <p v-if="favPath.name" class="text-xs text-text-secondary truncate">
                {{ favPath.path }}
              </p>
            </div>
            <div
              class="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
            >
              <button
                @click.stop="handleSendToTerminal(favPath)"
                class="p-1.5 rounded text-text-secondary hover:text-primary hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                :title="t('favoritePaths.sendToTerminal', 'Send to Terminal')"
              >
                <i class="fas fa-terminal text-xs"></i>
              </button>
              <button
                @click.stop="openEditModal(favPath)"
                class="p-1.5 rounded text-text-secondary hover:text-primary hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                :title="t('common.edit')"
              >
                <i class="fas fa-pencil-alt text-xs"></i>
              </button>
              <button
                @click.stop="handleDelete(favPath)"
                class="p-1.5 rounded text-text-secondary hover:text-error hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                :title="t('common.delete')"
              >
                <i class="fas fa-trash-alt text-xs"></i>
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <AddEditFavoritePathForm
      v-if="showAddEditModal"
      :is-visible="showAddEditModal"
      :path-data="editingPathItem"
      @close="showAddEditModal = false"
      @save-success="
        () => {
          favoritePathsStore.fetchFavoritePaths(t);
          showAddEditModal = false;
        }
      "
    />
  </div>
</template>
