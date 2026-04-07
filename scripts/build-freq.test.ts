/**
 * Build-script tests. Validates the URL resolution / size fallback logic
 * without touching the network.
 */

// Provide a factory mock so jest-expo's RN-style module loader does not try
// to auto-generate a mock from real axios (which blows up at import time
// because its fetch adapter runs against expo's ReadableStream polyfill).
jest.mock('axios', () => {
  const head = jest.fn();
  return { __esModule: true, default: { head }, head };
});

import axios from 'axios';
import { resolveCorpusUrl } from './build-freq';

const mockedHead = axios.head as unknown as jest.Mock;

beforeEach(() => {
  mockedHead.mockReset();
});

describe('resolveCorpusUrl', () => {
  it('returns the 300K URL when it exists', async () => {
    mockedHead.mockResolvedValue({ status: 200 });
    const r = await resolveCorpusUrl('eng', 2024);
    expect(r).not.toBeNull();
    expect(r!.size).toBe('300K');
    expect(r!.url).toContain('eng_news_2024_300K');
    expect(r!.triedSizes).toEqual(['300K']);
  });

  it('falls back to 100K when 300K is missing', async () => {
    mockedHead
      .mockResolvedValueOnce({ status: 404 }) // 300K
      .mockResolvedValueOnce({ status: 200 }); // 100K
    const r = await resolveCorpusUrl('nor', 2023);
    expect(r).not.toBeNull();
    expect(r!.size).toBe('100K');
    expect(r!.triedSizes).toEqual(['300K', '100K']);
  });

  it('falls back through all sizes', async () => {
    mockedHead
      .mockResolvedValueOnce({ status: 404 }) // 300K
      .mockResolvedValueOnce({ status: 404 }) // 100K
      .mockResolvedValueOnce({ status: 404 }) // 30K
      .mockResolvedValueOnce({ status: 200 }); // 10K
    const r = await resolveCorpusUrl('ces', 2022);
    expect(r).not.toBeNull();
    expect(r!.size).toBe('10K');
    expect(r!.triedSizes).toEqual(['300K', '100K', '30K', '10K']);
  });

  it('returns null when no size is available', async () => {
    mockedHead.mockResolvedValue({ status: 404 });
    const r = await resolveCorpusUrl('xxx', 2024);
    expect(r).toBeNull();
  });

  it('treats network errors as URL not found', async () => {
    mockedHead.mockRejectedValue(new Error('connect timeout'));
    const r = await resolveCorpusUrl('eng', 2024);
    expect(r).toBeNull();
  });

  it('honors a per-language size override (1M first for English)', async () => {
    mockedHead.mockResolvedValueOnce({ status: 200 }); // 1M
    const r = await resolveCorpusUrl('eng', 2024, ['1M', '300K', '100K', '30K', '10K']);
    expect(r).not.toBeNull();
    expect(r!.size).toBe('1M');
    expect(r!.url).toContain('eng_news_2024_1M');
    expect(r!.triedSizes).toEqual(['1M']);
  });

  it('falls back from 1M to 300K when 1M is not available', async () => {
    mockedHead
      .mockResolvedValueOnce({ status: 404 }) // 1M
      .mockResolvedValueOnce({ status: 200 }); // 300K
    const r = await resolveCorpusUrl('eng', 2024, ['1M', '300K', '100K', '30K', '10K']);
    expect(r).not.toBeNull();
    expect(r!.size).toBe('300K');
    expect(r!.triedSizes).toEqual(['1M', '300K']);
  });
});
