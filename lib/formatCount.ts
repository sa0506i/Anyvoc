/**
 * Compact number formatter used by the Leitner-box visual in
 * components/LearningMaturity.tsx. Kept in lib/ as a pure helper so it
 * stays unit-testable (jest.config.js testMatch covers only lib/ and
 * scripts/).
 *
 *   <1 000     → "123"
 *   <1 000 000 → "1.2k"  / "100k"
 *   ≥1 000 000 → "1.2M"  / "100M"
 *
 * Negative or non-finite values fall back to "0" — defensive only;
 * Leitner counts are always non-negative integers.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.floor(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  const m = n / 1_000_000;
  return m >= 100 ? `${Math.floor(m)}M` : `${m.toFixed(1).replace(/\.0$/, '')}M`;
}
