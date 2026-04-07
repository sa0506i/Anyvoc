import { useState, useCallback, useMemo } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getAllVocabulary, deleteVocabulary, updateVocabularyFields, type Vocabulary } from '../../lib/database';
import { useVocabularyList, SortOption } from '../../hooks/useVocabulary';
import VocabCard from '../../components/VocabCard';
import SwipeToDelete from '../../components/SwipeToDelete';
import EmptyState from '../../components/EmptyState';
import EditVocabModal from '../../components/EditVocabModal';
import { CEFR_LEVELS } from '../../constants/levels';
import { sortKey } from '../../lib/vocabSort';
import { useTheme } from '../../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../../constants/theme';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'alphabetical', label: 'A\u2013Z' },
  { value: 'level', label: 'Level' },
  { value: 'box', label: 'Box' },
];

export default function VocabularyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { searchQuery, sortBy, setSearchQuery, setSortBy } = useVocabularyList();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [editingVocab, setEditingVocab] = useState<Vocabulary | null>(null);

  const loadData = useCallback(() => {
    setVocabulary(getAllVocabulary(db));
  }, [db]);

  useFocusEffect(loadData);

  const filteredAndSorted = useMemo(() => {
    let result = vocabulary;

    // Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (v) =>
          v.original.toLowerCase().includes(q) ||
          v.translation.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'alphabetical':
          return sortKey(a.original).localeCompare(sortKey(b.original));
        case 'level':
          return CEFR_LEVELS.indexOf(a.level as any) - CEFR_LEVELS.indexOf(b.level as any);
        case 'box':
          return a.leitner_box - b.leitner_box;
        case 'date':
        default:
          return b.created_at - a.created_at;
      }
    });

    return result;
  }, [vocabulary, searchQuery, sortBy]);

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
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
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

      {/* List */}
      <FlatList
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
  });
