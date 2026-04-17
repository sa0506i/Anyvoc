import { useShareProcessingStore } from './useShareProcessingStore';

describe('useShareProcessingStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useShareProcessingStore.getState().stop();
  });

  afterEach(() => {
    jest.useRealTimers();
    useShareProcessingStore.getState().stop();
  });

  it('start sets processing + initial message', () => {
    useShareProcessingStore.getState().start('hello');
    const s = useShareProcessingStore.getState();
    expect(s.processing).toBe(true);
    expect(s.message).toBe('hello');
  });

  it('setRotating shows messages in order and stops on the last', () => {
    useShareProcessingStore.getState().setRotating(['a', 'b', 'c'], 100);
    expect(useShareProcessingStore.getState().message).toBe('a');

    jest.advanceTimersByTime(100);
    expect(useShareProcessingStore.getState().message).toBe('b');

    jest.advanceTimersByTime(100);
    expect(useShareProcessingStore.getState().message).toBe('c');

    // Rotation has stopped; advancing further leaves us on 'c'
    jest.advanceTimersByTime(1000);
    expect(useShareProcessingStore.getState().message).toBe('c');
  });

  it('setRotating with a single message shows it without starting a timer', () => {
    useShareProcessingStore.getState().setRotating(['only'], 100);
    expect(useShareProcessingStore.getState().message).toBe('only');
    jest.advanceTimersByTime(1000);
    expect(useShareProcessingStore.getState().message).toBe('only');
  });

  it('setRotating with empty array is a no-op', () => {
    useShareProcessingStore.getState().start('before');
    useShareProcessingStore.getState().setRotating([], 100);
    // Store unchanged: still the 'before' message, still processing
    expect(useShareProcessingStore.getState().message).toBe('before');
    expect(useShareProcessingStore.getState().processing).toBe(true);
  });

  it('setMessage during rotation cancels the timer', () => {
    useShareProcessingStore.getState().setRotating(['a', 'b', 'c'], 100);
    useShareProcessingStore.getState().setMessage('interrupted');
    jest.advanceTimersByTime(500);
    expect(useShareProcessingStore.getState().message).toBe('interrupted');
  });

  it('stop clears rotation and overlay', () => {
    useShareProcessingStore.getState().setRotating(['a', 'b'], 100);
    useShareProcessingStore.getState().stop();
    jest.advanceTimersByTime(500);
    const s = useShareProcessingStore.getState();
    expect(s.processing).toBe(false);
    expect(s.message).toBe('');
  });

  it('start during active rotation clears the rotation', () => {
    useShareProcessingStore.getState().setRotating(['a', 'b', 'c'], 100);
    useShareProcessingStore.getState().start('fresh');
    jest.advanceTimersByTime(500);
    expect(useShareProcessingStore.getState().message).toBe('fresh');
  });

  // ─── setRotatingPools ─────────────────────────────────────────────
  describe('setRotatingPools', () => {
    // Math.random returns 0 → always picks the first element of the
    // current `source` array (which is `unused` when available, else the
    // full pool). That gives fully deterministic phase-advance assertions.
    let randomSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
      randomSpy.mockRestore();
    });

    it('picks the first unused entry per phase when Math.random = 0', () => {
      const pools = [
        ['a1', 'a2'],
        ['b1', 'b2'],
        ['c1', 'c2'],
      ];
      useShareProcessingStore.getState().setRotatingPools(pools, 100);
      expect(useShareProcessingStore.getState().message).toBe('a1');

      jest.advanceTimersByTime(100);
      expect(useShareProcessingStore.getState().message).toBe('b1');

      jest.advanceTimersByTime(100);
      expect(useShareProcessingStore.getState().message).toBe('c1');
    });

    it('stays on the last phase and keeps picking random unused entries', () => {
      const pools = [['a1'], ['b1'], ['c1', 'c2', 'c3']];
      useShareProcessingStore.getState().setRotatingPools(pools, 100);

      jest.advanceTimersByTime(200); // reach phase 3
      expect(useShareProcessingStore.getState().message).toBe('c1');

      jest.advanceTimersByTime(100);
      expect(useShareProcessingStore.getState().message).toBe('c2');

      jest.advanceTimersByTime(100);
      expect(useShareProcessingStore.getState().message).toBe('c3');
    });

    it('allows repeats within the final phase once its pool is exhausted', () => {
      const pools = [['a1'], ['b1', 'b2']];
      useShareProcessingStore.getState().setRotatingPools(pools, 100);
      // tick 0: 'a1'; tick 1: 'b1'; tick 2: 'b2' (last unused in phase 2).
      jest.advanceTimersByTime(300);
      // Pool b1/b2 now fully used; next tick must still produce a message,
      // falling back to the full pool (repeat allowed).
      jest.advanceTimersByTime(100);
      const msg = useShareProcessingStore.getState().message;
      expect(['b1', 'b2']).toContain(msg);
    });

    it('does not repeat across earlier phases (no loop-back)', () => {
      const pools = [['a1', 'a2'], ['b1'], ['c1']];
      useShareProcessingStore.getState().setRotatingPools(pools, 100);
      // tick 0 → 'a1'
      jest.advanceTimersByTime(100); // tick 1 → 'b1'
      jest.advanceTimersByTime(100); // tick 2 → 'c1'
      expect(useShareProcessingStore.getState().message).toBe('c1');
      // Ticks 3+ must stay on 'c1' (only entry in the final pool) —
      // never pick 'a2' from an earlier pool.
      for (let i = 0; i < 10; i += 1) {
        jest.advanceTimersByTime(100);
        expect(useShareProcessingStore.getState().message).toBe('c1');
      }
    });

    it('empty outer array is a no-op', () => {
      useShareProcessingStore.getState().start('before');
      useShareProcessingStore.getState().setRotatingPools([], 100);
      expect(useShareProcessingStore.getState().message).toBe('before');
      expect(useShareProcessingStore.getState().processing).toBe(true);
    });

    it('single-pool form keeps picking randomly from that one pool', () => {
      const pools = [['a1', 'a2', 'a3']];
      useShareProcessingStore.getState().setRotatingPools(pools, 100);
      expect(useShareProcessingStore.getState().message).toBe('a1');
      jest.advanceTimersByTime(100);
      expect(useShareProcessingStore.getState().message).toBe('a2');
      jest.advanceTimersByTime(100);
      expect(useShareProcessingStore.getState().message).toBe('a3');
      jest.advanceTimersByTime(100);
      // All used, repeats allowed now.
      const msg = useShareProcessingStore.getState().message;
      expect(['a1', 'a2', 'a3']).toContain(msg);
    });

    it('setMessage cancels an active pool rotation', () => {
      useShareProcessingStore.getState().setRotatingPools([['a1'], ['b1'], ['c1']], 100);
      useShareProcessingStore.getState().setMessage('interrupted');
      jest.advanceTimersByTime(500);
      expect(useShareProcessingStore.getState().message).toBe('interrupted');
    });

    it('stop clears pool rotation', () => {
      useShareProcessingStore.getState().setRotatingPools([['a1'], ['b1']], 100);
      useShareProcessingStore.getState().stop();
      jest.advanceTimersByTime(500);
      const s = useShareProcessingStore.getState();
      expect(s.processing).toBe(false);
      expect(s.message).toBe('');
    });
  });
});
