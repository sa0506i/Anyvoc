import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import {
  getContentById,
  getVocabularyByContentId,
  insertVocabulary,
  vocabularyExists,
  deleteVocabulary,
  type Content,
  type Vocabulary,
} from '../../lib/database';
import { translateSingleWord, ClaudeAPIError } from '../../lib/claude';
import { useSettings } from '../../hooks/useSettings';
import { getLanguageName } from '../../constants/languages';
import { generateUUID } from '../../lib/uuid';
import HighlightedText from '../../components/HighlightedText';
import VocabCard from '../../components/VocabCard';
import SwipeToDelete from '../../components/SwipeToDelete';
import { useTheme } from '../../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../../constants/theme';

type Tab = 'original' | 'translation' | 'vocabulary';

export default function ContentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { nativeLanguage, learningLanguage } = useSettings();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Load data synchronously on first render to avoid flash
  const [content, setContent] = useState<Content | null>(() =>
    id ? getContentById(db, id) : null
  );
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>(() =>
    id ? getVocabularyByContentId(db, id) : []
  );
  const [activeTab, setActiveTab] = useState<Tab>('original');
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(() => {
    if (!id) return;
    setContent(getContentById(db, id));
    setVocabulary(getVocabularyByContentId(db, id));
  }, [db, id]);

  useFocusEffect(loadData);

  // Build highlight ranges by finding vocab words in the original text
  const highlights = useMemo(() => {
    if (!content) return [];
    const ranges: { start: number; end: number; vocabId: string }[] = [];
    const text = content.original_text;

    for (const v of vocabulary) {
      // Prefer source_forms (exact text forms) over derived search terms
      let searchWords: string[];
      if (v.source_forms) {
        try {
          const forms = JSON.parse(v.source_forms) as string[];
          searchWords = forms.length > 0 ? forms : extractSearchTerms(v.original);
        } catch {
          searchWords = extractSearchTerms(v.original);
        }
      } else {
        searchWords = extractSearchTerms(v.original);
      }

      for (const searchWord of searchWords) {
        if (searchWord.length < 2) continue;
        const escaped = escapeRegex(searchWord);
        const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
        let match;
        while ((match = regex.exec(text)) !== null) {
          const overlaps = ranges.some(
            (r) => match!.index < r.end && match!.index + match![0].length > r.start
          );
          if (!overlaps) {
            ranges.push({
              start: match.index,
              end: match.index + match[0].length,
              vocabId: v.id,
            });
          }
        }
      }
    }

    return ranges;
  }, [content, vocabulary]);

  const handleRemoveHighlight = (vocabId: string) => {
    deleteVocabulary(db, vocabId);
    setVocabulary((prev) => prev.filter((v) => v.id !== vocabId));
  };

  const handleAddWord = (word: string) => {
    Alert.alert(
      'Add Vocabulary',
      `Add "${word}" to your vocabulary list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add', onPress: () => addWordToVocabulary(word) },
      ]
    );
  };

  const addWordToVocabulary = async (word: string) => {
    setLoading(true);
    try {
      const nativeName = getLanguageName(nativeLanguage);
      const learningName = getLanguageName(learningLanguage);
      const result = await translateSingleWord(word, learningName, nativeName);

      if (!result.translation) {
        Alert.alert('Error', 'Translation could not be determined.');
        return;
      }

      if (vocabularyExists(db, result.original)) {
        Alert.alert('Already exists', `"${result.original}" is already in your vocabulary list.`);
        return;
      }

      const newVocab: Vocabulary = {
        id: generateUUID(),
        content_id: id!,
        original: result.original,
        translation: result.translation,
        level: result.level,
        word_type: result.type as Vocabulary['word_type'],
        source_forms: JSON.stringify([word]),
        leitner_box: 1,
        last_reviewed: null,
        correct_count: 0,
        incorrect_count: 0,
        created_at: Date.now(),
      };

      insertVocabulary(db, newVocab);
      setVocabulary((prev) => [...prev, newVocab]);
      Alert.alert('Added', `"${result.original}" → "${result.translation}"`);
    } catch (error) {
      if (error instanceof ClaudeAPIError) {
        Alert.alert('API Error', error.message);
      } else {
        Alert.alert('Error', 'Could not add word.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteVocab = (vocabId: string) => {
    handleRemoveHighlight(vocabId);
  };

  if (!content) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Content not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        {(['original', 'translation', 'vocabulary'] as Tab[]).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'original' ? 'Original' : tab === 'translation' ? 'Translation' : `Vocabulary (${vocabulary.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === 'original' && (
        <ScrollView style={styles.scrollContent} contentContainerStyle={styles.textContent}>
          <HighlightedText
            text={content.original_text}
            highlights={highlights}
            onRemoveHighlight={handleRemoveHighlight}
            onAddWord={handleAddWord}
          />
          <Text style={styles.hint}>
            Tap highlighted words to remove. Long press a word to add it.
          </Text>
        </ScrollView>
      )}

      {activeTab === 'translation' && (
        <ScrollView style={styles.scrollContent} contentContainerStyle={styles.textContent}>
          {content.translated_text ? (
            <Text style={styles.bodyText}>{content.translated_text}</Text>
          ) : (
            <Text style={styles.emptyText}>No translation available</Text>
          )}
        </ScrollView>
      )}

      {activeTab === 'vocabulary' && (
        <FlatList
          data={vocabulary}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <SwipeToDelete onDelete={() => handleDeleteVocab(item.id)}>
              <VocabCard
                original={item.original}
                translation={item.translation}
                level={item.level}
                wordType={item.word_type}
                leitnerBox={item.leitner_box}
              />
            </SwipeToDelete>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No vocabulary yet</Text>
          }
        />
      )}

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Articles and reflexive pronouns to strip from vocab entries for text matching
const STRIP_PREFIX = /^(ein|eine|einen|einem|einer|der|die|das|dem|den|des|un|une|des|du|le|la|les|l'|el|la|los|las|un|una|unos|unas|il|lo|la|i|gli|le|un|uno|una|un'|the|a|an|o|os|a|as|um|uma|uns|umas|de|het|een|en|ett|się|se|si|s'|sich)\s+/i;

/**
 * Extract search terms from a vocab entry's "original" field.
 * Handles:
 * - Comma-separated forms: "un médecin, une médecin" → ["médecin"]
 * - Articles: "une maison" → ["maison"]
 * - Reflexive verbs: "se souvenir" → ["souvenir"]
 * - Adjective forms: "beau, belle" → ["beau", "belle"]
 */
function extractSearchTerms(original: string): string[] {
  const terms = new Set<string>();

  // Split on comma to handle multiple forms
  const parts = original.split(/,/).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    // Strip leading articles / reflexive pronouns
    const stripped = part.replace(STRIP_PREFIX, '').trim();
    if (stripped) {
      terms.add(stripped);
      // Also add individual words for multi-word entries
      const words = stripped.split(/\s+/);
      if (words.length > 1) {
        for (const w of words) {
          if (w.length >= 3) terms.add(w);
        }
      }
    }
  }

  // Also try the full original (without article) as one term
  const fullStripped = original.replace(STRIP_PREFIX, '').split(',')[0].trim();
  if (fullStripped) terms.add(fullStripped);

  return Array.from(terms);
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorText: {
      fontSize: fontSize.md,
      color: c.error,
    },
    tabBar: {
      flexDirection: 'row',
      backgroundColor: c.backgroundMid,
      borderBottomWidth: 1,
      borderBottomColor: c.glassBorder,
    },
    tab: {
      flex: 1,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: {
      borderBottomColor: c.primary,
    },
    tabText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '500',
    },
    tabTextActive: {
      color: c.text,
    },
    scrollContent: {
      flex: 1,
    },
    textContent: {
      padding: spacing.md,
    },
    listContent: {
      padding: spacing.md,
    },
    bodyText: {
      fontSize: fontSize.md,
      lineHeight: fontSize.md * 1.6,
      color: c.text,
      fontWeight: '300',
    },
    emptyText: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      textAlign: 'center',
      marginTop: spacing.xl,
    },
    hint: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: spacing.lg,
      fontStyle: 'italic',
      fontWeight: '300',
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(5, 13, 26, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
