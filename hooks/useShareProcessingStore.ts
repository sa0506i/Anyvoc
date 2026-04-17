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
   * Start a sequential rotation through `messages`, advancing every
   * `intervalMs` ms. First message is shown immediately. Rotation stops
   * on the last entry (no loop) — the final message stays until
   * `setMessage` / `setRotating` / `setRotatingPools` / `stop` is called.
   * Empty array is a no-op.
   */
  setRotating: (messages: readonly string[], intervalMs?: number) => void;
  /**
   * Phase-based random rotation. Each inner pool in `pools` is tied to
   * one elapsed-time window; every `intervalMs` the store advances one
   * phase and picks a random message from the current pool. Messages
   * already shown in this rotation are preferred out of the pool (no
   * repeats within a session). Once the final pool is reached the
   * rotation stays there and keeps picking random messages from it —
   * never loops back to earlier phases. Repeats inside the last pool
   * are only allowed after the pool has been exhausted.
   * Empty outer array is a no-op.
   */
  setRotatingPools: (pools: readonly (readonly string[])[], intervalMs?: number) => void;
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
  setRotatingPools: (pools, intervalMs = ROTATION_INTERVAL_MS) => {
    clearRotation();
    if (pools.length === 0) return;

    const used = new Set<string>();
    const pickFromPool = (pool: readonly string[]): string => {
      const unused = pool.filter((m) => !used.has(m));
      const source = unused.length > 0 ? unused : pool;
      const msg = source[Math.floor(Math.random() * source.length)];
      used.add(msg);
      return msg;
    };

    set({ processing: true, message: pickFromPool(pools[0]) });
    if (pools.length === 1) {
      // Single pool: keep rotating randomly within it.
      rotationTimer = setInterval(() => {
        set({ message: pickFromPool(pools[0]) });
      }, intervalMs);
      return;
    }

    let tick = 0;
    const lastIdx = pools.length - 1;
    rotationTimer = setInterval(() => {
      tick += 1;
      const phaseIdx = tick < lastIdx ? tick : lastIdx;
      set({ message: pickFromPool(pools[phaseIdx]) });
    }, intervalMs);
  },
  stop: () => {
    clearRotation();
    set({ processing: false, message: '' });
  },
}));
