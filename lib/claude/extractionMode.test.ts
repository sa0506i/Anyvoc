/**
 * Guards the production default for the extraction-mode kill-switch.
 *
 * Flipping EXTRACTION_MODE to 'serial' is an intentional rollback action
 * and must ship as an explicit commit. This test catches accidental
 * reversion (e.g. a merge conflict resolved the wrong way) by asserting
 * the default stays 'parallel' — our baseline since 2026-04-24.
 */

import { EXTRACTION_MODE } from './extractionMode';

describe('EXTRACTION_MODE', () => {
  it('defaults to "parallel" (production baseline)', () => {
    expect(EXTRACTION_MODE).toBe('parallel');
  });
});
