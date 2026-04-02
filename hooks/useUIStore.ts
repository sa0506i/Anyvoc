import { create } from 'zustand';

interface UIStore {
  addMenuRequested: boolean;
  requestAddMenu: () => void;
  clearAddMenuRequest: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  addMenuRequested: false,
  requestAddMenu: () => set({ addMenuRequested: true }),
  clearAddMenuRequest: () => set({ addMenuRequested: false }),
}));
