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
import VocabRow from '../../components/VocabRow';
import EditVocabModal from '../../components/EditVocabModal';
import {
  DEFAULT_SORT_DIRECTION,
  sortVocabulary,
  extractSearchTerms,
  escapeRegex,
  type SortOption,
  type SortDirection,
} from '../../lib/vocabSort';
import SortChips from '../../components/SortChips';
import { useTheme } from '../../hooks/useTheme';
import { useAlert } from '../../components/ConfirmDialog';
import { isAtOrAboveLevel } from '../../constants/levels';
import { spacing, fontSize, type ThemeColors } from '../../constants/theme';

type Tab = 'original' | 'translation' | 'vocabulary';

export default function ContentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const nativeLanguage = useSettingsStore((s) => s.nativeLanguage);
  const learningLanguage = useSettingsStore((s) => s.learningLanguage);
  const minLevel = useSettingsStore((s) => s.level);
  const proMode = useSettingsStore((s) => s.proMode);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { alert, confirm, AlertDialog } = useAlert();

  const Header = ({ title }: { title: string }) => (
    <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
      <View style={styles.headerSideLeft}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>{'\u2190 Back'}</Text>
        </Pressable>
      </View>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSide} />
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
  const [sortBy, setSortByRaw] = useState<SortOption>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT_DIRECTION.date);
  const setSortBy = useCallback(
    (sort: SortOption) => {
      if (sort === sortBy) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortByRaw(sort);
        setSortDirection(DEFAULT_SORT_DIRECTION[sort]);
      }
    },
    [sortBy],
  );

  const sortedVocabulary = useMemo(() => {
    // Hide vocab below the user's CEFR minimum. Storage is untouched —
    // lowering the level brings them back. Architecture rule 20.
    // Exception: words the user explicitly added via long-press
    // (user_added=1) bypass this filter — their intent beats the level
    // setting.
    const filtered = vocabulary.filter(
      (v) => v.user_added === 1 || isAtOrAboveLevel(v.level, minLevel),
    );
    return sortVocabulary(filtered, sortBy, sortDirection);
  }, [vocabulary, sortBy, sortDirection, minLevel]);

  const loadData = useCallback(() => {
    if (!id) return;
    setContent(getContentById(db, id));
    setVocabulary(getVocabularyByContentId(db, id));
  }, [db, id]);

  useFocusEffect(loadData);

  // Build highlight ranges by finding vocab words in the original text.
  // Single-pass: union all search terms into one regex and walk the
  // text once, then attribute each match to its vocab id via a lookup
  // map. Previously this was O(vocab × forms) separate regex walks and
  // an overlap check per hit — fine at a few entries, noticeable past
  // ~100.
  const highlights = useMemo(() => {
    if (!content) return [];
    const text = content.original_text;

    // Lower-cased term → first vocab id that registered it. We keep
    // the first registration so the display behaviour matches the old
    // vocabulary-iteration order when two entries share a form.
    const termToVocabId = new Map<string, string>();
    const terms: string[] = [];

    for (const v of vocabulary) {
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
      for (const w of searchWords) {
        if (w.length < 2) continue;
        const key = w.toLowerCase();
        if (!termToVocabId.has(key)) {
          termToVocabId.set(key, v.id);
          terms.push(w);
        }
      }
    }

    if (terms.length === 0) return [];

    // Longest-first so a shorter alternative that fails its right-edge
    // lookahead doesn't shadow a longer one in the rare case where
    // both start at the same offset.
    terms.sort((a, b) => b.length - a.length);
    const pattern = `(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}])`;
    const regex = new RegExp(pattern, 'giu');

    const ranges: { start: number; end: number; vocabId: string }[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const vocabId = termToVocabId.get(match[0].toLowerCase());
      if (vocabId) {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
          vocabId,
        });
      }
    }

    return ranges;
  }, [content, vocabulary]);

  const handleRemoveHighlight = useCallback(
    (vocabId: string) => {
      deleteVocabulary(db, vocabId);
      setVocabulary((prev) => prev.filter((v) => v.id !== vocabId));
    },
    [db],
  );

  const addWordToVocabulary = useCallback(
    async (word: string) => {
      setLoading(true);
      try {
        const nativeName = getLanguageEnglishName(nativeLanguage);
        const learningName = getLanguageEnglishName(learningLanguage);
        const result = await translateSingleWord(
          word,
          learningName,
          nativeName,
          learningLanguage as SupportedLanguage,
          nativeLanguage,
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
          // User explicitly picked this word via long-press — bypass the
          // CEFR level filter in vocab views (CLAUDE.md "Vocabulary
          // post-processing" → user_added bypass, Rule 20).
          user_added: 1,
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
    },
    [alert, db, id, learningLanguage, nativeLanguage],
  );

  const handleAddWord = useCallback(
    (word: string) => {
      confirm(
        'Add Vocabulary',
        `Add "${word}" to your vocabulary list?`,
        () => addWordToVocabulary(word),
        {
          confirmLabel: 'Add',
        },
      );
    },
    [addWordToVocabulary, confirm],
  );

  const handleDeleteVocab = useCallback(
    (vocab: Vocabulary) => {
      deleteVocabulary(db, vocab.id);
      setVocabulary((prev) => prev.filter((v) => v.id !== vocab.id));
    },
    [db],
  );

  const handleEditVocab = useCallback((vocab: Vocabulary) => {
    setEditingVocab(vocab);
  }, []);

  const renderVocabRow = useCallback(
    ({ item }: { item: Vocabulary }) => (
      <VocabRow item={item} onDelete={handleDeleteVocab} onEdit={handleEditVocab} />
    ),
    [handleDeleteVocab, handleEditVocab],
  );

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
            onRemoveHighlight={proMode ? handleRemoveHighlight : undefined}
            onAddWord={proMode ? handleAddWord : undefined}
          />
          <Text style={styles.hint}>
            {proMode
              ? 'Tap highlighted words to remove. Long press a word to add it.'
              : 'Enable Pro mode to add and remove words manually from the text.'}
          </Text>
        </ScrollView>
      )}

      {activeTab === 'translation' && (
        <ScrollView style={styles.scrollContent} contentContainerStyle={styles.textContent}>
          {content.translated_text && content.translated_text.trim().length > 0 ? (
            <Text style={styles.bodyText}>{content.translated_text}</Text>
          ) : (
            <View style={styles.proPlaceholder}>
              <Text style={styles.proPlaceholderText}>
                Full-text translation is a Pro feature. Enable Pro mode in Settings.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {activeTab === 'vocabulary' && (
        <FlatList
          data={sortedVocabulary}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            vocabulary.length > 0 ? (
              <View style={styles.sortRowWrapper}>
                <SortChips sortBy={sortBy} sortDirection={sortDirection} onPress={setSortBy} />
              </View>
            ) : null
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: spacing.xl + insets.bottom },
          ]}
          renderItem={renderVocabRow}
          removeClippedSubviews
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={7}
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
    headerSideLeft: {
      width: 80,
      alignItems: 'flex-start',
    },
    headerSide: {
      width: 80,
      alignItems: 'flex-end',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    backText: {
      fontSize: fontSize.md,
      color: c.primary,
      fontWeight: '600',
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
    sortRowWrapper: {
      paddingBottom: spacing.md,
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
    proPlaceholder: {
      padding: spacing.lg,
      alignItems: 'center',
    },
    proPlaceholderText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '300',
      textAlign: 'center',
      lineHeight: 20,
    },
  });
