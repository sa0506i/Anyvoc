import { useState, useMemo, useCallback } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** When true, only show a single "OK" button (no cancel). */
  infoOnly?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  destructive = false,
  infoOnly = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttonRow}>
            {!infoOnly && (
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  styles.cancelButton,
                  pressed && styles.pressed,
                ]}
                onPress={onCancel}
              >
                <Text style={styles.cancelText}>{cancelLabel}</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.button,
                destructive ? styles.destructiveButton : styles.confirmButton,
                pressed && styles.pressed,
              ]}
              onPress={onConfirm}
            >
              <Text style={[styles.confirmText, destructive && styles.destructiveText]}>
                {infoOnly ? 'OK' : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── useAlert hook ─────────────────────────────────────────────────
// Replaces imperative Alert.alert() with a themed ConfirmDialog.
// Usage:
//   const { alert, confirm, AlertDialog } = useAlert();
//   alert('Title', 'Message');                          // info only
//   confirm('Title', 'Message', onConfirm);             // with cancel
//   confirm('Title', 'Message', onConfirm, { destructive: true, confirmLabel: 'Delete' });
//   return <>{...}<AlertDialog /></>;                   // render once in JSX

interface AlertState {
  visible: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  infoOnly: boolean;
  destructive: boolean;
  confirmLabel: string;
  cancelLabel: string;
}

const INITIAL_STATE: AlertState = {
  visible: false,
  title: '',
  message: '',
  onConfirm: () => {},
  infoOnly: true,
  destructive: false,
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
};

interface ConfirmOptions {
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function useAlert() {
  const [state, setState] = useState<AlertState>(INITIAL_STATE);

  const dismiss = useCallback(() => setState((s) => ({ ...s, visible: false })), []);

  const alert = useCallback((title: string, message: string) => {
    setState({
      visible: true,
      title,
      message,
      onConfirm: () => {},
      infoOnly: true,
      destructive: false,
      confirmLabel: 'OK',
      cancelLabel: 'Cancel',
    });
  }, []);

  const confirm = useCallback(
    (title: string, message: string, onConfirm: () => void, options?: ConfirmOptions) => {
      setState({
        visible: true,
        title,
        message,
        onConfirm,
        infoOnly: false,
        destructive: options?.destructive ?? false,
        confirmLabel: options?.confirmLabel ?? 'Confirm',
        cancelLabel: options?.cancelLabel ?? 'Cancel',
      });
    },
    [],
  );

  const AlertDialog = useCallback(
    () => (
      <ConfirmDialog
        visible={state.visible}
        title={state.title}
        message={state.message}
        infoOnly={state.infoOnly}
        destructive={state.destructive}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        onCancel={dismiss}
        onConfirm={() => {
          dismiss();
          state.onConfirm();
        }}
      />
    ),
    [state, dismiss],
  );

  return { alert, confirm, AlertDialog };
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.xl,
    },
    dialog: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: c.backgroundMid,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    message: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '300',
      lineHeight: 20,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    button: {
      flex: 1,
      padding: spacing.md,
      borderRadius: borderRadius.full,
      alignItems: 'center',
    },
    cancelButton: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    confirmButton: {
      backgroundColor: c.primary,
    },
    destructiveButton: {
      backgroundColor: c.errorBgLight,
      borderWidth: 1,
      borderColor: c.errorBgMedium,
    },
    cancelText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    confirmText: {
      color: '#FFFFFF',
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    destructiveText: {
      color: c.error,
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });
