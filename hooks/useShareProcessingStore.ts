import { create } from 'zustand';
import { ROTATION_INTERVAL_MS } from '../constants/progressMessages';

interface ShareProcessingStore {
  processing: boolean;
  message: string;
  /** Activate overlay with an initial single message. Clears any rotation. */
  start: (msg: string) => void;
  /** Replace current message with a single static one. Clears any rotation. */
  setMessage: (msg: string) => void;
  /**
   * Start a rotation through `messages`, advancing every `intervalMs` ms.
   * First message is shown immediately. Rotation stops on the last entry
   * (no loop) — the final message stays until `setMessage` / `setRotating`
   * / `stop` is called. If `messages` is empty, does nothing.
   */
  setRotating: (messages: readonly string[], intervalMs?: number) => void;
  /** Hide overlay and clear any active rotation. */
  stop: () => void;
}

// Timer handle lives outside the Zustand state because it's non-serializable
// and doesn't need to trigger re-renders.
let rotationTimer: ReturnType<typeof setInterval> | null = null;

function clearRotation(): void {
  if (rotationTimer !== null) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
}

export const useShareProcessingStore = create<ShareProcessingStore>((set) => ({
  processing: false,
  message: '',
  start: (msg) => {
    clearRotation();
    set({ processing: true, message: msg });
  },
  setMessage: (msg) => {
    clearRotation();
    set({ message: msg });
  },
  setRotating: (messages, intervalMs = ROTATION_INTERVAL_MS) => {
    clearRotation();
    if (messages.length === 0) return;
    set({ processing: true, message: messages[0] });
    if (messages.length === 1) return;
    let idx = 0;
    rotationTimer = setInterval(() => {
      idx += 1;
      set({ message: messages[idx] });
      if (idx >= messages.length - 1) {
        clearRotation();
      }
    }, intervalMs);
  },
  stop: () => {
    clearRotation();
    set({ processing: false, message: '' });
  },
}));
