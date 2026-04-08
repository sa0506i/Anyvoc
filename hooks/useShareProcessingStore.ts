import { create } from 'zustand';

interface ShareProcessingStore {
  processing: boolean;
  message: string;
  start: (msg: string) => void;
  setMessage: (msg: string) => void;
  stop: () => void;
}

export const useShareProcessingStore = create<ShareProcessingStore>((set) => ({
  processing: false,
  message: '',
  start: (msg) => set({ processing: true, message: msg }),
  setMessage: (msg) => set({ message: msg }),
  stop: () => set({ processing: false, message: '' }),
}));
