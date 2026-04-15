import { create } from 'zustand';
import { DEFAULT_SORT_DIRECTION, type SortOption, type SortDirection } from '../lib/vocabSort';

export type { SortOption, SortDirection } from '../lib/vocabSort';

interface VocabularyListState {
  searchQuery: string;
  sortBy: SortOption;
  sortDirection: SortDirection;
  setSearchQuery: (query: string) => void;
  /**
   * Tap behaviour for the sort chips:
   *  - tapping the active chip toggles direction (asc ↔ desc)
   *  - tapping a different chip switches sort + applies that option's
   *    natural default direction (DEFAULT_SORT_DIRECTION)
   */
  setSortBy: (sort: SortOption) => void;
}

export const useVocabularyList = create<VocabularyListState>((set, get) => ({
  searchQuery: '',
  sortBy: 'date',
  sortDirection: DEFAULT_SORT_DIRECTION.date,
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortBy: (sort) => {
    const { sortBy, sortDirection } = get();
    if (sort === sortBy) {
      set({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortBy: sort, sortDirection: DEFAULT_SORT_DIRECTION[sort] });
    }
  },
}));
