import { defineStore } from 'pinia';
import apiClient from '../utils/apiClient';
import { useUiNotificationsStore } from './uiNotifications.store';

// TODO: Define these types more precisely based on API response
export type FavoritePathSortType = 'name' | 'last_used_at';

export interface FavoritePathItem {
  id: string;
  path: string;
  name?: string;
  last_used_at?: number | null; // Added last_used_at
  // Add other relevant fields from the API if any
  createdAt?: string;
  updatedAt?: string;
}

export interface FavoritePathsState {
  favoritePaths: FavoritePathItem[];
  isLoading: boolean;
  error: string | null;
  searchTerm: string;
  currentSortBy: FavoritePathSortType;
  isInitialized: boolean;
}

export const useFavoritePathsStore = defineStore('favoritePaths', {
  state: (): FavoritePathsState => {
    const savedSortBy = localStorage.getItem('favoritePathSortBy') as FavoritePathSortType | null;
    return {
      favoritePaths: [],
      isLoading: false,
      error: null,
      searchTerm: '',
      currentSortBy: savedSortBy || 'name',
      isInitialized: false,
    };
  },
  getters: {
    // The filteredFavoritePaths getter will now operate on the already sorted list
    filteredFavoritePaths(state): FavoritePathItem[] {
      if (!state.searchTerm) {
        return state.favoritePaths;
      }
      const lowerCaseSearchTerm = state.searchTerm.toLowerCase();
      // Note: state.favoritePaths is now always sorted by this.currentSortBy
      return state.favoritePaths.filter(
        (fav) =>
          fav.path.toLowerCase().includes(lowerCaseSearchTerm) ||
          (fav.name && fav.name.toLowerCase().includes(lowerCaseSearchTerm))
      );
    },
    getFavoritePathById(state): (id: string) => FavoritePathItem | undefined {
      return (id) => state.favoritePaths.find((fav) => fav.id === id);
    },
  },
  actions: {
    _sortFavoritePaths() {
      this.favoritePaths.sort((a, b) => {
        if (this.currentSortBy === 'name') {
          const nameA = a.name?.toLowerCase() || a.path.toLowerCase();
          const nameB = b.name?.toLowerCase() || b.path.toLowerCase();
          if (nameA < nameB) return -1;
          if (nameA > nameB) return 1;
          return 0;
        }
        if (this.currentSortBy === 'last_used_at') {
          // Sort by last_used_at descending, nulls/undefined last
          const timeA = a.last_used_at ?? 0;
          const timeB = b.last_used_at ?? 0;
          return timeB - timeA; // Descending
        }
        return 0;
      });
    },
    setSearchTerm(term: string) {
      this.searchTerm = term;
    },
    async initializeFavoritePaths(t: (key: string, defaultMessage: string) => string) {
      if (this.isInitialized) {
        return;
      }
      this.isInitialized = true;
      await this.fetchFavoritePaths(t);
    },
    async fetchFavoritePaths(t: (key: string, defaultMessage: string) => string) {
      this.isLoading = true;
      this.error = null;
      const notificationsStore = useUiNotificationsStore();
      try {
        // Fetch all paths, sorting will be done locally
        const response = await apiClient.get<FavoritePathItem[]>('/favorite-paths');
        this.favoritePaths = response.data;
        this._sortFavoritePaths(); // Sort locally after fetching
      } catch (err: any) {
        this.error = err.message || 'Failed to fetch favorite paths';
        console.error('Error fetching favorite paths:', err);
        this.isInitialized = false; // +++ 如果获取失败，允许重试初始化 +++
      } finally {
        this.isLoading = false;
      }
    },
    setSortBy(sortBy: FavoritePathSortType) {
      this.currentSortBy = sortBy;
      localStorage.setItem('favoritePathSortBy', sortBy);
      this._sortFavoritePaths(); // Re-sort locally
    },
    async markPathAsUsed(pathId: string, t: (key: string, defaultMessage: string) => string) {
      const notificationsStore = useUiNotificationsStore();
      try {
        const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
          `/favorite-paths/${pathId}/update-last-used`
        );
        const updatedPath = response.data.favoritePath;
        if (updatedPath) {
          const index = this.favoritePaths.findIndex((p) => p.id === pathId);
          if (index !== -1) {
            this.favoritePaths[index] = updatedPath;
          } else {
            // Path not found locally, might happen if list is stale. Add it.
            this.favoritePaths.push(updatedPath);
          }
          this._sortFavoritePaths(); // Re-sort after updating
        } else {
          // Fallback to re-fetch if updated item isn't returned as expected
          console.warn('markPathAsUsed did not receive updated path, re-fetching list.');
          await this.fetchFavoritePaths(t);
        }
      } catch (err: any) {
        console.error(`Error marking path ${pathId} as used:`, err);
        notificationsStore.addNotification({
          message: t('favoritePaths.notifications.markAsUsedError', 'Failed to mark path as used.'),
          type: 'error',
        });
      }
    },
    async addFavoritePath(
      newPathData: Omit<FavoritePathItem, 'id' | 'createdAt' | 'updatedAt' | 'last_used_at'>,
      t: (key: string, defaultMessage: string) => string
    ) {
      this.isLoading = true;
      this.error = null;
      const notificationsStore = useUiNotificationsStore();
      try {
        const response = await apiClient.post<{ message: string; favoritePath: FavoritePathItem }>(
          '/favorite-paths',
          newPathData
        );
        this.favoritePaths.push(response.data.favoritePath);
        this._sortFavoritePaths(); // Sort after adding
        notificationsStore.addNotification({
          message: t('favoritePaths.notifications.addSuccess', 'Favorite path added successfully.'),
          type: 'success',
        });
      } catch (err: any) {
        this.error = err.message || 'Failed to add favorite path';
        console.error('Error adding favorite path:', err);
        notificationsStore.addNotification({
          message: t('favoritePaths.notifications.addError', 'Failed to add favorite path.'),
          type: 'error',
        });
        throw err; // Re-throw to allow form to handle error
      } finally {
        this.isLoading = false;
      }
    },
    async updateFavoritePath(
      id: string,
      updatedPathData: Partial<
        Omit<FavoritePathItem, 'id' | 'createdAt' | 'updatedAt' | 'last_used_at'>
      >,
      t: (key: string, defaultMessage: string) => string
    ) {
      this.isLoading = true;
      this.error = null;
      const notificationsStore = useUiNotificationsStore();
      try {
        const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
          `/favorite-paths/${id}`,
          updatedPathData
        );
        const index = this.favoritePaths.findIndex((fav) => fav.id === id);
        if (index !== -1) {
          this.favoritePaths[index] = response.data.favoritePath;
          this._sortFavoritePaths(); // Sort after updating
        }
        notificationsStore.addNotification({
          message: t(
            'favoritePaths.notifications.updateSuccess',
            'Favorite path updated successfully.'
          ),
          type: 'success',
        });
      } catch (err: any) {
        this.error = err.message || 'Failed to update favorite path';
        console.error('Error updating favorite path:', err);
        notificationsStore.addNotification({
          message: t('favoritePaths.notifications.updateError', 'Failed to update favorite path.'),
          type: 'error',
        });
        throw err; // Re-throw to allow form to handle error
      } finally {
        this.isLoading = false;
      }
    },
    async deleteFavoritePath(id: string, t: (key: string, defaultMessage: string) => string) {
      this.isLoading = true;
      this.error = null;
      const notificationsStore = useUiNotificationsStore();
      try {
        await apiClient.delete(`/favorite-paths/${id}`);
        this.favoritePaths = this.favoritePaths.filter((fav) => fav.id !== id);
        notificationsStore.addNotification({
          message: t(
            'favoritePaths.notifications.deleteSuccess',
            'Favorite path deleted successfully.'
          ),
          type: 'success',
        });
      } catch (err: any) {
        this.error = err.message || 'Failed to delete favorite path';
        console.error('Error deleting favorite path:', err);
        notificationsStore.addNotification({
          message: t('favoritePaths.notifications.deleteError', 'Failed to delete favorite path.'),
          type: 'error',
        });
      } finally {
        this.isLoading = false;
      }
    },
  },
});
