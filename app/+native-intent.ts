import type { NativeIntent } from 'expo-router';

export const redirectSystemPath: NativeIntent['redirectSystemPath'] = ({ path, initial }) => {
  // Share intent URLs (from expo-share-intent) should not be routed by Expo Router.
  // The ShareIntentProvider handles these URLs via useLinkingURL() independently.
  if (path.includes('dataUrl=') && path.includes('ShareKey')) {
    return '/(tabs)/content';
  }
  return path;
};
