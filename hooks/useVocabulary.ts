import { create } from 'zustand';

export type SortOption = 'date' | 'alphabetical' | 'level' | 'box';

interface VocabularyListState {
  searchQuery: string;
  sortBy: SortOption;
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
}

export const useVocabularyList = create<VocabularyListState>((set) => ({
  searchQuery: '',
  sortBy: 'date',
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortBy: (sort) => set({ sortBy: sort }),
}));
