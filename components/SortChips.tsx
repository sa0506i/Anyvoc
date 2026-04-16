import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SORT_OPTIONS, type SortOption, type SortDirection } from '../lib/vocabSort';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

interface SortChipsProps {
  sortBy: SortOption;
  sortDirection: SortDirection;
  onPress: (sort: SortOption) => void;
}

export default function SortChips({ sortBy, sortDirection, onPress }: SortChipsProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.sortRow}>
      {SORT_OPTIONS.map((opt) => {
        const isActive = sortBy === opt.value;
        return (
          <Pressable
            key={opt.value}
            style={({ pressed }) => [
              styles.sortChip,
              isActive && styles.sortChipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => onPress(opt.value)}
          >
            <Text style={[styles.sortChipText, isActive && styles.sortChipTextActive]}>
              {opt.label}
            </Text>
            {isActive && (
              <Ionicons
                name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'}
                size={14}
                color="#FFFFFF"
                style={styles.sortChipChevron}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    sortRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    sortChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.full,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    sortChipChevron: {
      marginLeft: spacing.xs,
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
    pressed: {
      opacity: 0.7,
    },
  });
