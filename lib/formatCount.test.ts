import { formatCount } from './formatCount';

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [9, '9'],
    [99, '99'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [1500, '1.5k'],
    [9999, '10k'],
    [10_000, '10k'],
    [99_500, '99.5k'],
    [100_000, '100k'],
    [999_999, '999k'],
    [1_000_000, '1M'],
    [1_200_000, '1.2M'],
    [99_500_000, '99.5M'],
    [100_000_000, '100M'],
  ])('formats %i as "%s"', (n, expected) => {
    expect(formatCount(n)).toBe(expected);
  });

  it('returns "0" for negative or non-finite input', () => {
    expect(formatCount(-1)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('floors fractional integers below 1000', () => {
    expect(formatCount(99.9)).toBe('99');
  });
});
