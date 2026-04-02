import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

interface VocabCardProps {
  original: string;
  translation: string;
  level: string;
  wordType: string;
  leitnerBox?: number;
  sourceName?: string;
  onPress?: () => void;
}

export default function VocabCard({
  original,
  translation,
  level,
  wordType,
  leitnerBox,
  sourceName,
  onPress,
}: VocabCardProps) {
  const { colors, levelColors, boxColors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.mainRow}>
        <View style={styles.textColumn}>
          <Text style={styles.original}>{original}</Text>
          <Text style={styles.translation}>{translation}</Text>
        </View>
        <View style={styles.badges}>
          <View style={[styles.levelBadge, { backgroundColor: levelColors[level] ?? colors.border }]}>
            <Text style={styles.levelText}>{level}</Text>
          </View>
          {leitnerBox !== undefined && (
            <View style={[styles.boxBadge, { backgroundColor: boxColors[leitnerBox] ?? colors.border }]}>
              <Text style={styles.boxText}>{leitnerBox}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={styles.wordType}>{wordType}</Text>
        {sourceName && <Text style={styles.source} numberOfLines={1}>{sourceName}</Text>}
      </View>
    </Pressable>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
      overflow: 'hidden',
    },
    mainRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    textColumn: {
      flex: 1,
      gap: 2,
    },
    original: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
    },
    translation: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '300',
    },
    badges: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    levelBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    levelText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    boxBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      justifyContent: 'center',
      alignItems: 'center',
    },
    boxText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    wordType: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontStyle: 'italic',
      fontWeight: '300',
    },
    source: {
      flex: 1,
      fontSize: fontSize.xs,
      color: c.textSecondary,
    },
  });
