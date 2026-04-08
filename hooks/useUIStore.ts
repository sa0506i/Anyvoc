import { create } from 'zustand';

interface UIStore {
  addMenuRequested: boolean;
  requestAddMenu: () => void;
  clearAddMenuRequest: () => void;
  contentRefreshNonce: number;
  bumpContentRefresh: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  addMenuRequested: false,
  requestAddMenu: () => set({ addMenuRequested: true }),
  clearAddMenuRequest: () => set({ addMenuRequested: false }),
  contentRefreshNonce: 0,
  bumpContentRefresh: () => set((s) => ({ contentRefreshNonce: s.contentRefreshNonce + 1 })),
}));
