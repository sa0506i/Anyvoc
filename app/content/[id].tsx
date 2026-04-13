import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getContentById,
  getVocabularyByContentId,
  insertVocabulary,
  vocabularyExists,
  deleteVocabulary,
  updateVocabularyFields,
  type Content,
  type Vocabulary,
} from '../../lib/database';
import { translateSingleWord, ClaudeAPIError, type SupportedLanguage } from '../../lib/claude';
import { useSettingsStore } from '../../hooks/useSettings';
import { getLanguageEnglishName } from '../../constants/languages';
import { generateUUID } from '../../lib/uuid';
import HighlightedText from '../../components/HighlightedText';
import VocabCard from '../../components/VocabCard';
import SwipeToDelete from '../../components/SwipeToDelete';
import EditVocabModal from '../../components/EditVocabModal';
import {
  SORT_OPTIONS,
  sortVocabulary,
  extractSearchTerms,
  escapeRegex,
  type SortOption,
} from '../../lib/vocabSort';
import { useTheme } from '../../hooks/useTheme';
import { useAlert } from '../../components/ConfirmDialog';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../../constants/theme';

type Tab = 'original' | 'translation' | 'vocabulary';

export default function ContentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const nativeLanguage = useSettingsStore((s) => s.nativeLanguage);
  const learningLanguage = useSettingsStore((s) => s.learningLanguage);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { alert, confirm, AlertDialog } = useAlert();

  const Header = ({ title }: { title: string }) => (
    <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
      <View style={styles.headerSide} />
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSide}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeButton}>
          <Ionicons name="close" size={20} color={colors.text} style={styles.closeIcon} />
        </Pressable>
      </View>
    </View>
  );

  // Load data synchronously on first render to avoid flash
  const [content, setContent] = useState<Content | null>(() =>
    id ? getContentById(db, id) : null,
  );
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>(() =>
    id ? getVocabularyByContentId(db, id) : [],
  );
  const [editingVocab, setEditingVocab] = useState<Vocabulary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('original');
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('date');

  const sortedVocabulary = useMemo(() => sortVocabulary(vocabulary, sortBy), [vocabulary, sortBy]);

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
            (r) => match!.index < r.end && match!.index + match![0].length > r.start,
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
    confirm(
      'Add Vocabulary',
      `Add "${word}" to your vocabulary list?`,
      () => addWordToVocabulary(word),
      {
        confirmLabel: 'Add',
      },
    );
  };

  const addWordToVocabulary = async (word: string) => {
    setLoading(true);
    try {
      const nativeName = getLanguageEnglishName(nativeLanguage);
      const learningName = getLanguageEnglishName(learningLanguage);
      const result = await translateSingleWord(
        word,
        learningName,
        nativeName,
        learningLanguage as SupportedLanguage,
      );

      if (!result.translation) {
        alert('Error', 'Translation could not be determined.');
        return;
      }

      if (vocabularyExists(db, result.original)) {
        alert('Already exists', `"${result.original}" is already in your vocabulary list.`);
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
      alert('Added', `"${result.original}" → "${result.translation}"`);
    } catch (error) {
      if (error instanceof ClaudeAPIError) {
        alert('API Error', error.message);
      } else {
        alert('Error', 'Could not add word.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteVocab = (vocabId: string) => {
    handleRemoveHighlight(vocabId);
  };

  const handleSaveEdit = (original: string, translation: string) => {
    if (!editingVocab) return;
    updateVocabularyFields(db, editingVocab.id, original, translation);
    setVocabulary((prev) =>
      prev.map((v) => (v.id === editingVocab.id ? { ...v, original, translation } : v)),
    );
    setEditingVocab(null);
  };

  if (!content) {
    return (
      <View style={styles.container}>
        <Header title="Content" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Content not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title={content.title} />
      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        {(['original', 'translation', 'vocabulary'] as Tab[]).map((tab) => (
          <Pressable
            key={tab}
            testID={`content-tab-${tab}`}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'original'
                ? 'Original'
                : tab === 'translation'
                  ? 'Translation'
                  : `Vocabulary (${vocabulary.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === 'original' && (
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={[
            styles.textContent,
            { paddingBottom: spacing.xxl + insets.bottom },
          ]}
        >
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
          data={sortedVocabulary}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            vocabulary.length > 0 ? (
              <View style={styles.sortRow}>
                {SORT_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={({ pressed }) => [
                      styles.sortChip,
                      sortBy === opt.value && styles.sortChipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => setSortBy(opt.value)}
                  >
                    <Text
                      style={[
                        styles.sortChipText,
                        sortBy === opt.value && styles.sortChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: spacing.xl + insets.bottom },
          ]}
          renderItem={({ item }) => (
            <SwipeToDelete
              onDelete={() => handleDeleteVocab(item.id)}
              onEdit={() => setEditingVocab(item)}
            >
              <VocabCard
                original={item.original}
                translation={item.translation}
                level={item.level}
                wordType={item.word_type}
                leitnerBox={item.leitner_box}
              />
            </SwipeToDelete>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No vocabulary yet</Text>}
          ListFooterComponent={
            vocabulary.length > 0 ? (
              <Text style={styles.swipeHint}>Swipe right to edit · Swipe left to delete</Text>
            ) : null
          }
        />
      )}

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      <EditVocabModal
        visible={editingVocab !== null}
        original={editingVocab?.original ?? ''}
        translation={editingVocab?.translation ?? ''}
        onSave={handleSaveEdit}
        onCancel={() => setEditingVocab(null)}
      />
      <AlertDialog />
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: c.backgroundMid,
    },
    headerSide: {
      width: 40,
      alignItems: 'flex-end',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.subtleOverlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeIcon: {
      lineHeight: 20,
      textAlign: 'center',
      textAlignVertical: 'center',
      includeFontPadding: false,
      width: 20,
      height: 20,
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
    sortRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingBottom: spacing.md,
    },
    sortChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.full,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    sortChipActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    sortChipText: {
      fontSize: fontSize.sm,
      fontWeight: '300' as const,
      color: c.text,
    },
    sortChipTextActive: {
      color: '#FFFFFF',
      fontWeight: '600' as const,
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
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginTop: spacing.xl,
      textAlign: 'center',
      fontStyle: 'italic',
      fontWeight: '300',
    },
    swipeHint: {
      textAlign: 'center',
      fontSize: fontSize.xs,
      fontWeight: '300',
      color: c.textSecondary,
      paddingTop: spacing.lg,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });
