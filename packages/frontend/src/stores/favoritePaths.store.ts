import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { useUiNotificationsStore } from './uiNotifications.store';
import { log } from '@/utils/log';

export type FavoritePathSortType = 'name' | 'last_used_at';

export interface FavoritePathItem {
  id: number;
  path: string;
  name: string | null;
  last_used_at?: number | null;
  created_at: number;
}

export const useFavoritePathsStore = defineStore('favoritePaths', () => {
  const VALID_SORT_TYPES: FavoritePathSortType[] = ['name', 'last_used_at'];
  const savedSortByRaw = localStorage.getItem('favoritePathSortBy');
  const savedSortBy = VALID_SORT_TYPES.includes(savedSortByRaw as FavoritePathSortType)
    ? (savedSortByRaw as FavoritePathSortType)
    : null;

  // --- State ---
  const favoritePaths = ref<FavoritePathItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const searchTerm = ref('');
  const currentSortBy = ref<FavoritePathSortType>(savedSortBy || 'name');
  const isInitialized = ref(false);

  // --- Getters ---
  const filteredFavoritePaths = computed((): FavoritePathItem[] => {
    if (!searchTerm.value) {
      return favoritePaths.value;
    }
    const lowerCaseSearchTerm = searchTerm.value.toLowerCase();
    return favoritePaths.value.filter(
      (fav) =>
        fav.path.toLowerCase().includes(lowerCaseSearchTerm) ||
        (fav.name && fav.name.toLowerCase().includes(lowerCaseSearchTerm))
    );
  });

  /**
   * Retrieve a favorite path by its id.
   *
   * @param id - The id of the favorite path to find
   * @returns The favorite path with the given id, or `undefined` if none exists
   */
  function getFavoritePathById(id: number) {
    return favoritePaths.value.find((fav) => fav.id === id);
  }

  /**
   * Sorts the `favoritePaths` array in place according to `currentSortBy`.
   *
   * When `currentSortBy` is `'name'`, sorts ascending by case-insensitive `name`, falling back to `path` when `name` is null.
   * When `currentSortBy` is `'last_used_at'`, sorts descending by `last_used_at`, treating missing values as `0`.
   * If `currentSortBy` has any other value, the order is left unchanged.
   */
  function _sortFavoritePaths() {
    favoritePaths.value.sort((a, b) => {
      if (currentSortBy.value === 'name') {
        const nameA = a.name?.toLowerCase() || a.path.toLowerCase();
        const nameB = b.name?.toLowerCase() || b.path.toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      }
      if (currentSortBy.value === 'last_used_at') {
        const timeA = a.last_used_at ?? 0;
        const timeB = b.last_used_at ?? 0;
        return timeB - timeA;
      }
      return 0;
    });
  }

  /**
   * Update the store's search term used to filter favorite paths.
   *
   * @param term - The new search text; an empty string clears the filter
   */
  function setSearchTerm(term: string) {
    searchTerm.value = term;
  }

  /**
   * Ensures the favorite paths list is initialized by fetching it once.
   *
   * If the store is not yet initialized, marks it initialized and triggers a fetch of favorite paths.
   *
   * @param t - Translation function used for notification/error messages during fetching
   */
  async function initializeFavoritePaths(t: (key: string, defaultMessage: string) => string) {
    if (isInitialized.value) {
      return;
    }
    isInitialized.value = true;
    await fetchFavoritePaths(t);
  }

  /**
   * Fetches the user's favorite paths from the API and updates the store state.
   *
   * On success, replaces `favoritePaths` with the response data and applies the current sort order.
   * On failure, records a descriptive error message and resets `isInitialized` to allow retries.
   */
  async function fetchFavoritePaths(_t: (key: string, defaultMessage: string) => string) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.get<FavoritePathItem[]>('/favorite-paths');
      favoritePaths.value = response.data;
      _sortFavoritePaths();
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to fetch favorite paths');
      log.error('Error fetching favorite paths:', err);
      isInitialized.value = false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Set the current sort mode for favorite paths and persist the choice to localStorage.
   *
   * @param sortBy - Sort mode: `'name'` to order by name (falling back to path) or `'last_used_at'` to order by most-recently used first
   */
  function setSortBy(sortBy: FavoritePathSortType) {
    currentSortBy.value = sortBy;
    localStorage.setItem('favoritePathSortBy', sortBy);
    _sortFavoritePaths();
  }

  /**
   * Mark a favorite path as recently used and update the store with the server's returned record.
   *
   * Calls the backend to update the path's "last used" timestamp; if the response contains an updated
   * favorite path, replaces the existing item (or appends it if missing) and re-sorts the list.
   * If the response lacks the updated record, triggers a full refresh of favorite paths. On error,
   * logs the failure and adds an error notification using the provided translator.
   *
   * @param pathId - The ID of the favorite path to mark as used
   * @param t - Translation function that accepts a message key and default message and returns a localized string
   */
  async function markPathAsUsed(
    pathId: number,
    t: (key: string, defaultMessage: string) => string
  ) {
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
        `/favorite-paths/${pathId}/update-last-used`
      );
      const updatedPath = response.data.favoritePath;
      if (updatedPath) {
        const index = favoritePaths.value.findIndex((p) => p.id === pathId);
        if (index !== -1) {
          favoritePaths.value[index] = updatedPath;
        } else {
          favoritePaths.value.push(updatedPath);
        }
        _sortFavoritePaths();
      } else {
        log.warn('markPathAsUsed did not receive updated path, re-fetching list.');
        await fetchFavoritePaths(t);
      }
    } catch (err: unknown) {
      log.error(`Error marking path ${pathId} as used:`, err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.markAsUsedError', 'Failed to mark path as used.'),
        type: 'error',
      });
    }
  }

  /**
   * Create a new favorite path on the server and add it to the local store.
   *
   * On success, the created favorite path is appended to `favoritePaths`, the list is re-sorted,
   * and a success notification is shown. The function sets `isLoading` while the request is in progress
   * and populates `error` on failure.
   *
   * @param newPathData - Object with the properties required to create a favorite path (`path` and optional `name`)
   * @param t - Translation function used to produce notification messages
   * @throws Propagates the original error if the API request fails
   */
  async function addFavoritePath(
    newPathData: Omit<FavoritePathItem, 'id' | 'created_at' | 'last_used_at'>,
    t: (key: string, defaultMessage: string) => string
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.post<{ message: string; favoritePath: FavoritePathItem }>(
        '/favorite-paths',
        newPathData
      );
      favoritePaths.value.push(response.data.favoritePath);
      _sortFavoritePaths();
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.addSuccess', 'Favorite path added successfully.'),
        type: 'success',
      });
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to add favorite path');
      log.error('Error adding favorite path:', err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.addError', 'Failed to add favorite path.'),
        type: 'error',
      });
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Update an existing favorite path on the server, update the local store entry, re-sort the list, and show a success or error notification.
   *
   * Updates the corresponding item in `favoritePaths` with the server response when successful; on failure the error state is populated, a notification is shown, and the error is re-thrown.
   *
   * @param id - The identifier of the favorite path to update
   * @param updatedPathData - Partial favorite path fields to update (excluding `id`, `created_at`, and `last_used_at`)
   * @param t - Translation function used to produce notification messages
   * @throws Propagates the original error when the update request fails
   */
  async function updateFavoritePath(
    id: number,
    updatedPathData: Partial<Omit<FavoritePathItem, 'id' | 'created_at' | 'last_used_at'>>,
    t: (key: string, defaultMessage: string) => string
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
        `/favorite-paths/${id}`,
        updatedPathData
      );
      const index = favoritePaths.value.findIndex((fav) => fav.id === id);
      if (index !== -1) {
        favoritePaths.value[index] = response.data.favoritePath;
        _sortFavoritePaths();
      }
      notificationsStore.addNotification({
        message: t(
          'favoritePaths.notifications.updateSuccess',
          'Favorite path updated successfully.'
        ),
        type: 'success',
      });
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to update favorite path');
      log.error('Error updating favorite path:', err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.updateError', 'Failed to update favorite path.'),
        type: 'error',
      });
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Deletes a favorite path by its ID, updates the store state accordingly, and emits a UI notification for success or failure.
   *
   * On success the corresponding item is removed from `favoritePaths` and a success notification is added.
   * On failure the store `error` is set and an error notification is added.
   *
   * @param id - The identifier of the favorite path to delete
   * @param t - Translation function for notification messages (key, defaultMessage) => translated string
   */
  async function deleteFavoritePath(
    id: number,
    t: (key: string, defaultMessage: string) => string
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      await apiClient.delete(`/favorite-paths/${id}`);
      favoritePaths.value = favoritePaths.value.filter((fav) => fav.id !== id);
      notificationsStore.addNotification({
        message: t(
          'favoritePaths.notifications.deleteSuccess',
          'Favorite path deleted successfully.'
        ),
        type: 'success',
      });
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to delete favorite path');
      log.error('Error deleting favorite path:', err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.deleteError', 'Failed to delete favorite path.'),
        type: 'error',
      });
    } finally {
      isLoading.value = false;
    }
  }

  return {
    favoritePaths,
    isLoading,
    error,
    searchTerm,
    currentSortBy,
    isInitialized,
    filteredFavoritePaths,
    getFavoritePathById,
    setSearchTerm,
    initializeFavoritePaths,
    fetchFavoritePaths,
    setSortBy,
    markPathAsUsed,
    addFavoritePath,
    updateFavoritePath,
    deleteFavoritePath,
    // 向后兼容：测试直接调用排序方法
    _sortFavoritePaths,
  };
});
