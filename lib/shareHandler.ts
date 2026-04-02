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
    // Check if it looks like a URL
    const urlPattern = /^https?:\/\//i;
    if (urlPattern.test(shareIntent.text.trim())) {
      return { type: 'link', url: shareIntent.text.trim() };
    }
    return { type: 'text', text: shareIntent.text };
  }

  return null;
}
