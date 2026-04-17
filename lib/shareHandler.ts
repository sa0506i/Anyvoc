import { ShareIntentFile } from 'expo-share-intent';

export interface SharedContent {
  type: 'text' | 'image' | 'link';
  text?: string;
  imageUri?: string;
  imageBase64?: string;
  mimeType?: string;
  url?: string;
}

export function parseShareIntent(shareIntent: {
  text?: string | null;
  files?: ShareIntentFile[] | null;
  type?: string | null;
  webUrl?: string | null;
}): SharedContent | null {
  // Check for web URL
  if (shareIntent.webUrl) {
    return { type: 'link', url: shareIntent.webUrl };
  }

  // Check for files (images)
  if (shareIntent.files && shareIntent.files.length > 0) {
    const file = shareIntent.files[0];
    if (file.mimeType?.startsWith('image/')) {
      return {
        type: 'image',
        imageUri: file.path,
        mimeType: file.mimeType,
      };
    }
  }

  // Check for text
  if (shareIntent.text) {
    const trimmed = shareIntent.text.trim();
    // A regex-only `/^https?:\/\//i` check accepts malformed URLs that
    // later trip up fetch + HTML parsing. Use the URL constructor so
    // only syntactically valid http(s) URLs are treated as links; the
    // rest fall through to plain text.
    if (isValidHttpUrl(trimmed)) {
      return { type: 'link', url: trimmed };
    }
    return { type: 'text', text: shareIntent.text };
  }

  return null;
}

function isValidHttpUrl(candidate: string): boolean {
  try {
    const u = new URL(candidate);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
