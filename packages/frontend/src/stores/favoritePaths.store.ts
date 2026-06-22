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
        (fav.name && fav.name.toLowerCase().includes(lowerCaseSearchTerm)),
    );
  });

  /**
   * Retrieve a favorite path item by its id.
   *
   * @param id - The favorite path's numeric id
   * @returns The matching `FavoritePathItem` if found, `undefined` otherwise
   */
  function getFavoritePathById(id: number) {
    return favoritePaths.value.find((fav) => fav.id === id);
  }

  /**
   * Sorts the store's `favoritePaths` array in place according to `currentSortBy`.
   *
   * When `currentSortBy` is `'name'`, items are ordered alphabetically by `name` with `path` as a fallback.
   * When `currentSortBy` is `'last_used_at'`, items are ordered by `last_used_at` with the most recent first; missing timestamps are treated as `0`.
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
   * Updates the current search query used to filter favorite paths.
   *
   * @param term - The new search string; an empty string clears the filter
   */
  function setSearchTerm(term: string) {
    searchTerm.value = term;
  }

  /**
   * Ensures favorite paths are initialized once by setting the initialization flag and fetching the list.
   *
   * @param t - Translation function used to localize messages passed to the fetch operation
   */
  async function initializeFavoritePaths(t: (key: string, defaultMessage: string) => string) {
    if (isInitialized.value) {
      return;
    }
    isInitialized.value = true;
    await fetchFavoritePaths(t);
  }

  /**
   * Fetches favorite paths from the API and updates the store with the results.
   *
   * On success replaces `favoritePaths` with the response data and re-sorts them.
   * On failure sets `error` to the extracted message and resets `isInitialized` to `false`.
   * Toggles `isLoading` for the duration of the request.
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
   * Update the store's active sort key for favorite paths and persist it to localStorage.
   *
   * @param sortBy - The sort key to apply: `'name'` (sort by display name with fallback to `path`) or `'last_used_at'` (sort by most recently used)
   */
  function setSortBy(sortBy: FavoritePathSortType) {
    currentSortBy.value = sortBy;
    localStorage.setItem('favoritePathSortBy', sortBy);
    _sortFavoritePaths();
  }

  /**
   * Mark a favorite path as recently used and update the local list accordingly.
   *
   * Sends a request to update the path's "last used" timestamp, then replaces the matching
   * item in `favoritePaths` (or appends it if not present) and re-sorts the list. If the
   * response does not include the updated item the store will re-fetch the full list. On
   * failure it logs the error and adds an error notification using the provided translator.
   *
   * @param t - Translation function used to produce localized notification messages
   */
  async function markPathAsUsed(
    pathId: number,
    t: (key: string, defaultMessage: string) => string,
  ) {
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
        `/favorite-paths/${pathId}/update-last-used`,
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
   * Creates a new favorite path on the server and updates the store with the resulting item.
   *
   * Adds the created favorite path to the store's list, re-applies the current sort order, and emits a success notification on success. On failure it records the error, emits an error notification, and rethrows the original error.
   *
   * @param newPathData - Favorite path data to create (must not include `id`, `created_at`, or `last_used_at`)
   * @param t - Translation function used to produce user-facing notification messages
   * @throws The original error thrown by the API client when the create request fails
   */
  async function addFavoritePath(
    newPathData: Omit<FavoritePathItem, 'id' | 'created_at' | 'last_used_at'>,
    t: (key: string, defaultMessage: string) => string,
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.post<{ message: string; favoritePath: FavoritePathItem }>(
        '/favorite-paths',
        newPathData,
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
   * Update an existing favorite path on the server and synchronize the local store.
   *
   * @param id - The ID of the favorite path to update.
   * @param updatedPathData - Partial fields to update; must not include `id`, `created_at`, or `last_used_at`.
   * @param t - Translation function that accepts a translation key and a default message and returns a localized string.
   * @throws The original error thrown by the API request when the update fails.
   */
  async function updateFavoritePath(
    id: number,
    updatedPathData: Partial<Omit<FavoritePathItem, 'id' | 'created_at' | 'last_used_at'>>,
    t: (key: string, defaultMessage: string) => string,
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
        `/favorite-paths/${id}`,
        updatedPathData,
      );
      const index = favoritePaths.value.findIndex((fav) => fav.id === id);
      if (index !== -1) {
        favoritePaths.value[index] = response.data.favoritePath;
        _sortFavoritePaths();
      }
      notificationsStore.addNotification({
        message: t(
          'favoritePaths.notifications.updateSuccess',
          'Favorite path updated successfully.',
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
   * Delete the favorite path with the given id, remove it from the local store, and show a success or error notification.
   *
   * @param id - The id of the favorite path to delete.
   * @param t - Translation function that accepts a translation key and a default message and returns the localized string.
   */
  async function deleteFavoritePath(
    id: number,
    t: (key: string, defaultMessage: string) => string,
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
          'Favorite path deleted successfully.',
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
