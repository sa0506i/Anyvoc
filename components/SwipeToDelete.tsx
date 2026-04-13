import { useRef, useMemo } from 'react';
import { Animated, StyleSheet, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { spacing, borderRadius, type ThemeColors } from '../constants/theme';

interface SwipeToDeleteProps {
  children: React.ReactNode;
  onDelete: () => void;
  onEdit?: () => void;
}

export default function SwipeToDelete({ children, onDelete, onEdit }: SwipeToDeleteProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const swipeableRef = useRef<Swipeable>(null);

  const handleDelete = () => {
    swipeableRef.current?.close();
    onDelete();
  };

  const handleEdit = () => {
    swipeableRef.current?.close();
    onEdit?.();
  };

  const renderRightActions = (progress: Animated.AnimatedInterpolation<number>) => {
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.5, 1],
      extrapolate: 'clamp',
    });

    return (
      <Pressable style={styles.deleteContainer} onPress={handleDelete}>
        <Animated.View style={[styles.actionIcon, { transform: [{ scale }] }]}>
          <Ionicons name="trash" size={24} color={colors.error} />
        </Animated.View>
      </Pressable>
    );
  };

  const renderLeftActions = (progress: Animated.AnimatedInterpolation<number>) => {
    if (!onEdit) return null;

    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.5, 1],
      extrapolate: 'clamp',
    });

    return (
      <Pressable style={styles.editContainer} onPress={handleEdit}>
        <Animated.View style={[styles.actionIcon, { transform: [{ scale }] }]}>
          <Ionicons name="create-outline" size={24} color={colors.primary} />
        </Animated.View>
      </Pressable>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      renderLeftActions={onEdit ? renderLeftActions : undefined}
      overshootRight={false}
      overshootLeft={false}
    >
      {children}
    </Swipeable>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    deleteContainer: {
      backgroundColor: c.errorBgLight,
      justifyContent: 'center',
      alignItems: 'center',
      width: 72,
      borderRadius: borderRadius.md,
      marginBottom: spacing.sm,
      marginLeft: spacing.sm,
    },
    editContainer: {
      backgroundColor: c.successBgLight,
      justifyContent: 'center',
      alignItems: 'center',
      width: 72,
      borderRadius: borderRadius.md,
      marginBottom: spacing.sm,
      marginRight: spacing.sm,
    },
    actionIcon: {
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
