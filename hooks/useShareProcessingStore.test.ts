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
});
