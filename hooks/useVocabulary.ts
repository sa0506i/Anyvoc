import { create } from 'zustand';
import type { SortOption } from '../lib/vocabSort';

export type { SortOption } from '../lib/vocabSort';

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
