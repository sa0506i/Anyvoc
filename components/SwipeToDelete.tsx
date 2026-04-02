import { useRef, useMemo } from 'react';
import { Animated, StyleSheet, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { spacing, borderRadius, type ThemeColors } from '../constants/theme';

interface SwipeToDeleteProps {
  children: React.ReactNode;
  onDelete: () => void;
}

export default function SwipeToDelete({ children, onDelete }: SwipeToDeleteProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const swipeableRef = useRef<Swipeable>(null);

  const handleDelete = () => {
    swipeableRef.current?.close();
    onDelete();
  };

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.5, 1],
      extrapolate: 'clamp',
    });

    return (
      <Pressable style={styles.deleteContainer} onPress={handleDelete}>
        <Animated.View style={[styles.deleteIcon, { transform: [{ scale }] }]}>
          <Ionicons name="trash" size={24} color={colors.error} />
        </Animated.View>
      </Pressable>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
    >
      {children}
    </Swipeable>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    deleteContainer: {
      backgroundColor: 'rgba(255, 77, 106, 0.3)',
      justifyContent: 'center',
      alignItems: 'center',
      width: 72,
      borderRadius: borderRadius.md,
      marginBottom: spacing.sm,
      marginLeft: spacing.sm,
    },
    deleteIcon: {
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
