import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, type ThemeColors } from '../constants/theme';

interface EmptyStateProps {
  title?: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export default function EmptyState({
  title = 'No content',
  subtitle = 'Add texts, images, or links to extract vocabulary. You can also share links from your browser (e.g. news articles) directly to Anyvoc.',
  icon = 'document-text-outline',
}: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={64} color={colors.border} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.xl,
      gap: spacing.sm,
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
      marginTop: spacing.md,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      fontWeight: '300',
      color: c.textSecondary,
      textAlign: 'center',
    },
  });
