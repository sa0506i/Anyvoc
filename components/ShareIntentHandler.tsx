import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useShareIntentContext } from 'expo-share-intent';
import { parseShareIntent } from '../lib/shareHandler';
import { processSharedText } from '../lib/shareProcessing';
import { fetchArticleContent } from '../lib/urlExtractor';
import { ClaudeAPIError } from '../lib/claude';
import { useSettingsStore } from '../hooks/useSettings';
import { useShareProcessingStore } from '../hooks/useShareProcessingStore';
import { useUIStore } from '../hooks/useUIStore';

/**
 * Invisible root-level component that handles incoming system share intents.
 *
 * On intent arrival:
 *  1. Navigates to the Content tab (regardless of current tab)
 *  2. Triggers the global loading overlay via useShareProcessingStore
 *  3. Runs the full processing pipeline (fetch → extract → translate → insert)
 *  4. Bumps useUIStore.contentRefreshNonce so the Content tab reloads
 *  5. Clears the overlay and resets the share intent
 *
 * Mounted in app/_layout.tsx inside ShareIntentProvider + SQLiteProvider +
 * ThemeProvider.
 */
export default function ShareIntentHandler() {
  const router = useRouter();
  const db = useSQLiteContext();
  const nativeLanguage = useSettingsStore((s) => s.nativeLanguage);
  const learningLanguage = useSettingsStore((s) => s.learningLanguage);
  const level = useSettingsStore((s) => s.level);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const shareStore = useShareProcessingStore();
  const bumpContentRefresh = useUIStore((s) => s.bumpContentRefresh);

  // Prevent double-processing if the effect re-runs while still working
  const processingRef = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || processingRef.current) return;

    const parsed = parseShareIntent(shareIntent);
    if (!parsed) {
      resetShareIntent();
      return;
    }

    // Image shares are not supported via the global handler (the existing
    // content.tsx flow handles user-picked images with its own pipeline).
    if (parsed.type === 'image') {
      resetShareIntent();
      return;
    }

    processingRef.current = true;

    const run = async () => {
      // Always switch to the Content tab first so the user sees the
      // destination once processing finishes.
      router.navigate('/(tabs)/content');

      shareStore.start('Preparing...');

      try {
        let text: string;
        let title: string;
        let sourceType: 'text' | 'link';
        let sourceUrl: string | undefined;

        if (parsed.type === 'link' && parsed.url) {
          shareStore.setMessage('Fetching article...');
          const article = await fetchArticleContent(parsed.url);
          text =
            article.title !== parsed.url ? `${article.title}\n\n${article.text}` : article.text;
          title = article.title;
          sourceType = 'link';
          sourceUrl = parsed.url;
        } else if (parsed.type === 'text' && parsed.text) {
          text = parsed.text;
          title = '';
          sourceType = 'text';
        } else {
          shareStore.stop();
          resetShareIntent();
          processingRef.current = false;
          return;
        }

        const result = await processSharedText(
          db,
          text,
          title,
          sourceType,
          sourceUrl,
          { nativeLanguage, learningLanguage, level },
          shareStore.setMessage,
        );

        bumpContentRefresh();

        if (result.belowLevel) {
          Alert.alert(
            'Done',
            `${result.foundTotal} vocabulary items found, but all were below your level. Try lowering your level in settings.`,
          );
        } else {
          Alert.alert('Done', `${result.inserted} vocabulary items extracted.`);
        }
      } catch (error) {
        if (error instanceof ClaudeAPIError) {
          Alert.alert('API Error', error.message);
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          Alert.alert('Error', msg);
        }
      } finally {
        shareStore.stop();
        resetShareIntent();
        processingRef.current = false;
      }
    };

    run();
  }, [hasShareIntent]);

  return null;
}
