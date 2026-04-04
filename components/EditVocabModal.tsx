import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

interface EditVocabModalProps {
  visible: boolean;
  original: string;
  translation: string;
  onSave: (original: string, translation: string) => void;
  onCancel: () => void;
}

export default function EditVocabModal({
  visible,
  original,
  translation,
  onSave,
  onCancel,
}: EditVocabModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [editOriginal, setEditOriginal] = useState(original);
  const [editTranslation, setEditTranslation] = useState(translation);

  useEffect(() => {
    if (visible) {
      setEditOriginal(original);
      setEditTranslation(translation);
    }
  }, [visible, original, translation]);

  const canSave = editOriginal.trim().length > 0 && editTranslation.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>Edit Vocabulary</Text>

          <Text style={styles.label}>Original</Text>
          <TextInput
            style={styles.input}
            value={editOriginal}
            onChangeText={setEditOriginal}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Translation</Text>
          <TextInput
            style={styles.input}
            value={editTranslation}
            onChangeText={setEditTranslation}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
          />

          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
              onPress={() => canSave && onSave(editOriginal.trim(), editTranslation.trim())}
              disabled={!canSave}
            >
              <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(5, 13, 26, 0.7)',
    },
    card: {
      width: '85%',
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
      marginBottom: spacing.xs,
    },
    label: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '300',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    input: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.md,
      fontWeight: '300',
      color: c.text,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    cancelButton: {
      flex: 1,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.full,
      padding: spacing.md,
      alignItems: 'center',
    },
    cancelText: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      fontWeight: '300',
    },
    saveButton: {
      flex: 1,
      backgroundColor: c.primary,
      borderRadius: borderRadius.full,
      padding: spacing.md,
      alignItems: 'center',
    },
    saveButtonDisabled: {
      opacity: 0.4,
    },
    saveText: {
      fontSize: fontSize.md,
      color: '#FFFFFF',
      fontWeight: '600',
    },
    saveTextDisabled: {
      opacity: 0.6,
    },
  });
