import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

interface RecentDaysProps {
  reviewDays: string[]; // All review day strings (YYYY-MM-DD)
}

const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function RecentDays({ reviewDays }: RecentDaysProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const reviewSet = useMemo(() => new Set(reviewDays), [reviewDays]);

  const days = useMemo(() => {
    const result: { label: string; dateStr: string; isToday: boolean }[] = [];
    const now = new Date();
    for (let i = 9; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      result.push({
        label: DAY_ABBR[d.getDay()],
        dateStr,
        isToday: i === 0,
      });
    }
    return result;
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Last 10 Days</Text>
      <View style={styles.row}>
        {days.map((day) => {
          const hasReview = reviewSet.has(day.dateStr);
          return (
            <View key={day.dateStr} style={styles.dayColumn}>
              <Text style={styles.dayLabel}>{day.label}</Text>
              <View
                style={[
                  styles.dot,
                  hasReview ? styles.dotReviewed : styles.dotMissed,
                  day.isToday && styles.dotToday,
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const DOT_SIZE = 28;

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: spacing.sm,
    },
    title: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    dayColumn: {
      alignItems: 'center',
      gap: spacing.xs,
    },
    dayLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '400',
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      justifyContent: 'center',
      alignItems: 'center',
    },
    dotReviewed: {
      backgroundColor: 'rgba(77, 255, 181, 0.25)',
      borderWidth: 2,
      borderColor: c.success,
    },
    dotMissed: {
      backgroundColor: 'rgba(100, 150, 255, 0.08)',
      borderWidth: 1,
      borderColor: 'rgba(100, 150, 255, 0.15)',
    },
    dotToday: {
      borderWidth: 2,
      borderColor: c.primary,
    },
  });
