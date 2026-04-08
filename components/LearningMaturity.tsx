import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

interface LearningMaturityProps {
  boxCounts: Record<number, number>;
  onBoxPress?: (box: number) => void;
}

export const MATURITY_LABELS = ['New', 'Learning', 'Familiar', 'Known', 'Mastered'];

export default function LearningMaturity({ boxCounts, onBoxPress }: LearningMaturityProps) {
  const { colors, boxColors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      {[1, 2, 3, 4, 5].map((box, index) => (
        <Pressable
          key={box}
          style={styles.box}
          onPress={onBoxPress ? () => onBoxPress(box) : undefined}
          disabled={!onBoxPress}
        >
          <View style={[styles.boxVisual, { backgroundColor: boxColors[box] }]}>
            <Text style={styles.boxCount}>{boxCounts[box] ?? 0}</Text>
          </View>
          <Text style={styles.boxLabel}>{MATURITY_LABELS[index]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    box: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xs,
    },
    boxVisual: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: borderRadius.md,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    boxCount: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    boxLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
    },
  });
