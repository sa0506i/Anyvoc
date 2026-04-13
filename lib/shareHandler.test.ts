import { parseShareIntent } from './shareHandler';

describe('parseShareIntent', () => {
  it('returns link for webUrl', () => {
    const result = parseShareIntent({ webUrl: 'https://example.com/article' });
    expect(result).toEqual({ type: 'link', url: 'https://example.com/article' });
  });

  it('returns image for image file', () => {
    const result = parseShareIntent({
      files: [{ path: '/tmp/photo.jpg', mimeType: 'image/jpeg', fileName: 'photo.jpg' } as any],
    });
    expect(result).toEqual({
      type: 'image',
      imageUri: '/tmp/photo.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('ignores non-image files', () => {
    const result = parseShareIntent({
      files: [{ path: '/tmp/doc.pdf', mimeType: 'application/pdf', fileName: 'doc.pdf' } as any],
    });
    expect(result).toBeNull();
  });

  it('returns link when text is a URL', () => {
    const result = parseShareIntent({ text: '  https://example.com/page  ' });
    expect(result).toEqual({ type: 'link', url: 'https://example.com/page' });
  });

  it('returns text for plain text', () => {
    const result = parseShareIntent({ text: 'Der Hund spielt im Garten.' });
    expect(result).toEqual({ type: 'text', text: 'Der Hund spielt im Garten.' });
  });

  it('returns null for empty intent', () => {
    expect(parseShareIntent({})).toBeNull();
  });

  it('returns null when text is null', () => {
    expect(parseShareIntent({ text: null })).toBeNull();
  });

  it('prioritises webUrl over text', () => {
    const result = parseShareIntent({
      webUrl: 'https://example.com',
      text: 'some text',
    });
    expect(result).toEqual({ type: 'link', url: 'https://example.com' });
  });

  it('prioritises files over text', () => {
    const result = parseShareIntent({
      files: [{ path: '/tmp/img.png', mimeType: 'image/png', fileName: 'img.png' } as any],
      text: 'some text',
    });
    expect(result?.type).toBe('image');
  });

  it('handles empty files array and falls back to text', () => {
    const result = parseShareIntent({ files: [], text: 'Hello world' });
    expect(result).toEqual({ type: 'text', text: 'Hello world' });
  });

  it('detects http:// URLs in text', () => {
    const result = parseShareIntent({ text: 'http://example.com' });
    expect(result).toEqual({ type: 'link', url: 'http://example.com' });
  });
});
