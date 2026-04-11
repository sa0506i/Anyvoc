import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getAllVocabulary, deleteVocabulary, updateVocabularyFields, type Vocabulary } from '../../lib/database';
import { useVocabularyList } from '../../hooks/useVocabulary';
import VocabCard from '../../components/VocabCard';
import SwipeToDelete from '../../components/SwipeToDelete';
import EmptyState from '../../components/EmptyState';
import EditVocabModal from '../../components/EditVocabModal';
import { MATURITY_LABELS } from '../../components/LearningMaturity';
import { SORT_OPTIONS, sortVocabulary } from '../../lib/vocabSort';
import { useTheme } from '../../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../../constants/theme';

type ActiveFilter =
  | { type: 'box'; box: number }
  | { type: 'learnedToday' }
  | null;

export default function VocabularyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ box?: string; filter?: string }>();
  const { searchQuery, sortBy, setSearchQuery, setSortBy } = useVocabularyList();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [editingVocab, setEditingVocab] = useState<Vocabulary | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null);

  const loadData = useCallback(() => {
    setVocabulary(getAllVocabulary(db));
  }, [db]);

  useFocusEffect(loadData);

  // Apply filter from URL params (box, filter=learnedToday)
  // When params are cleared (e.g. direct tab tap), activeFilter resets too.
  useEffect(() => {
    if (params.box) {
      const boxNum = parseInt(params.box, 10);
      if (!isNaN(boxNum)) setActiveFilter({ type: 'box', box: boxNum });
    } else if (params.filter === 'learnedToday') {
      setActiveFilter({ type: 'learnedToday' });
    } else {
      setActiveFilter(null);
    }
  }, [params.box, params.filter]);

  const clearFilter = useCallback(() => {
    setActiveFilter(null);
    router.setParams({ box: undefined, filter: undefined });
  }, [router]);

  const filteredAndSorted = useMemo(() => {
    let result = vocabulary;

    // Active filter (from URL params)
    if (activeFilter?.type === 'box') {
      result = result.filter((v) => v.leitner_box === activeFilter.box);
    } else if (activeFilter?.type === 'learnedToday') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startMs = startOfDay.getTime();
      result = result.filter((v) => v.last_reviewed != null && v.last_reviewed >= startMs);
    }

    // Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (v) =>
          v.original.toLowerCase().includes(q) ||
          v.translation.toLowerCase().includes(q)
      );
    }

    return sortVocabulary(result, sortBy);
  }, [vocabulary, searchQuery, sortBy, activeFilter]);

  const handleDelete = (vocab: Vocabulary) => {
    deleteVocabulary(db, vocab.id);
    setVocabulary((prev) => prev.filter((v) => v.id !== vocab.id));
  };

  const handleSaveEdit = (original: string, translation: string) => {
    if (!editingVocab) return;
    updateVocabularyFields(db, editingVocab.id, original, translation);
    setVocabulary((prev) =>
      prev.map((v) => v.id === editingVocab.id ? { ...v, original, translation } : v)
    );
    setEditingVocab(null);
  };

  // No vocabulary at all → unified empty state, flex-centred (no search/sort UI)
  if (vocabulary.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState />
      </View>
    );
  }

  return (
    <View testID="vocabulary-screen" style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            testID="vocab-search-input"
            style={styles.searchText}
            placeholder="Search..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Sort */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.value}
            style={[styles.sortChip, sortBy === opt.value && styles.sortChipActive]}
            onPress={() => setSortBy(opt.value)}
          >
            <Text style={[styles.sortChipText, sortBy === opt.value && styles.sortChipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Active filter badge */}
      {activeFilter && (
        <View style={styles.filterBadgeRow}>
          <View style={styles.filterBadge}>
            <Text style={styles.filterBadgeText}>
              {activeFilter.type === 'box'
                ? `Maturity: ${MATURITY_LABELS[activeFilter.box - 1] ?? activeFilter.box}`
                : 'Learned today'}
            </Text>
            <Pressable onPress={clearFilter} hitSlop={8}>
              <Ionicons name="close" size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      )}

      {/* List */}
      <FlatList
        testID="vocab-list"
        data={filteredAndSorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: spacing.xl + 60 + insets.bottom },
        ]}
        renderItem={({ item }) => (
          <SwipeToDelete
            onDelete={() => handleDelete(item)}
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
        ListEmptyComponent={
          <View style={styles.searchEmptyState}>
            <Ionicons name="list-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No results</Text>
          </View>
        }
        ListFooterComponent={
          filteredAndSorted.length > 0 ? (
            <Text style={styles.swipeHint}>
              Swipe right to edit  ·  Swipe left to delete
            </Text>
          ) : null
        }
      />

      <EditVocabModal
        visible={editingVocab !== null}
        original={editingVocab?.original ?? ''}
        translation={editingVocab?.translation ?? ''}
        onSave={handleSaveEdit}
        onCancel={() => setEditingVocab(null)}
      />
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    searchRow: {
      padding: spacing.md,
      paddingBottom: 0,
    },
    searchInput: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.sm,
      gap: spacing.sm,
    },
    searchText: {
      flex: 1,
      paddingVertical: spacing.sm,
      fontSize: fontSize.md,
      fontWeight: '300' as const,
      color: c.text,
    },
    sortRow: {
      flexDirection: 'row',
      padding: spacing.md,
      gap: spacing.sm,
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
    list: {
      padding: spacing.md,
      paddingTop: 0,
      paddingBottom: 0,
    },
    searchEmptyState: {
      alignItems: 'center',
      padding: spacing.xxl,
      gap: spacing.sm,
    },
    emptyText: {
      fontSize: fontSize.md,
      fontWeight: '300' as const,
      color: c.textSecondary,
    },
    swipeHint: {
      textAlign: 'center',
      fontSize: fontSize.xs,
      fontWeight: '300' as const,
      color: c.textSecondary,
      paddingTop: spacing.lg,
    },
    filterBadgeRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    filterBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: c.primary,
      borderRadius: borderRadius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    filterBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: '600' as const,
      color: '#FFFFFF',
    },
  });
