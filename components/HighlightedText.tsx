import { memo, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { useAlert } from './ConfirmDialog';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

interface HighlightRange {
  start: number;
  end: number;
  vocabId: string;
}

interface HighlightedTextProps {
  text: string;
  highlights: HighlightRange[];
  onRemoveHighlight?: (vocabId: string) => void;
  onAddWord?: (word: string) => void;
}

// Dedup words in a segment, preserving first-seen casing and document
// order. Skips short function words (≤2 chars) — articles, prepositions,
// conjunctions are usually not what the user wants to add. Caps the list
// at PICKER_MAX so a long paragraph doesn't drown the user in choices.
const PICKER_MIN_LEN = 3;
const PICKER_MAX = 10;
function extractUniqueWords(segmentText: string): string[] {
  const re = /[\p{L}\p{N}]+(?:[''']\p{L}+)*/gu;
  const seen = new Set<string>();
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(segmentText)) !== null) {
    const w = m[0];
    if (w.length < PICKER_MIN_LEN) continue;
    // Skip pure-numeric tokens (years, page numbers, prices) — they
    // aren't vocabulary candidates.
    if (!/\p{L}/u.test(w)) continue;
    const key = w.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(w);
      if (result.length >= PICKER_MAX) break;
    }
  }
  return result;
}

function HighlightedText({ text, highlights, onRemoveHighlight, onAddWord }: HighlightedTextProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { confirm, AlertDialog } = useAlert();
  const [pickerWords, setPickerWords] = useState<string[] | null>(null);

  // Splitting a potentially 5000-char string into highlight + plain spans is
  // linear in (text length + highlight count), but still the single most
  // expensive synchronous block in this component. Caching it on [text,
  // highlights] prevents recomputation when theme / alert state flips.
  const segments = useMemo(() => {
    const sorted = [...highlights].sort((a, b) => a.start - b.start);
    const out: { text: string; highlight?: HighlightRange }[] = [];
    let lastEnd = 0;
    for (const h of sorted) {
      if (h.start > lastEnd) {
        out.push({ text: text.substring(lastEnd, h.start) });
      }
      out.push({ text: text.substring(h.start, h.end), highlight: h });
      lastEnd = h.end;
    }
    if (lastEnd < text.length) {
      out.push({ text: text.substring(lastEnd) });
    }
    return out;
  }, [text, highlights]);

  const handleHighlightPress = onRemoveHighlight
    ? (vocabId: string, word: string) => {
        confirm(
          'Remove Vocabulary',
          `Remove "${word}" from the vocabulary list?`,
          () => onRemoveHighlight(vocabId),
          {
            destructive: true,
            confirmLabel: 'Remove',
          },
        );
      }
    : undefined;

  const openWordPicker = useCallback(
    (segmentText: string) => {
      if (!onAddWord) return;
      const words = extractUniqueWords(segmentText);
      if (words.length === 0) return;
      setPickerWords(words);
    },
    [onAddWord],
  );

  const handlePickWord = useCallback(
    (word: string) => {
      setPickerWords(null);
      onAddWord?.(word);
    },
    [onAddWord],
  );

  const closePicker = useCallback(() => setPickerWords(null), []);

  return (
    <View>
      <Text style={styles.text}>
        {segments.map((seg, i) =>
          seg.highlight ? (
            <Text
              key={i}
              style={styles.highlighted}
              onPress={
                handleHighlightPress
                  ? () => handleHighlightPress(seg.highlight!.vocabId, seg.text)
                  : undefined
              }
            >
              {seg.text}
            </Text>
          ) : onAddWord ? (
            // Pro mode: single <Text> per plain segment. Long-press opens a
            // word picker so the user can pick a word to add. Trades a
            // one-extra-tap flow for ~10× fewer Text nodes on long texts,
            // which is the dominant mount-time cost.
            <Text key={i} onLongPress={() => openWordPicker(seg.text)}>
              {seg.text}
            </Text>
          ) : (
            // Basic mode: emit as raw string, no wrapper node at all.
            seg.text
          ),
        )}
      </Text>
      <Modal
        visible={pickerWords !== null}
        transparent
        animationType="fade"
        onRequestClose={closePicker}
      >
        <Pressable style={styles.pickerOverlay} onPress={closePicker}>
          <Pressable style={styles.pickerDialog} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Add word to vocabulary</Text>
            <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerList}>
              {pickerWords?.map((w) => (
                <Pressable
                  key={w}
                  style={({ pressed }) => [styles.pickerItem, pressed && styles.pickerItemPressed]}
                  onPress={() => handlePickWord(w)}
                >
                  <Text style={styles.pickerItemText}>{w}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.pickerCancel} onPress={closePicker}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <AlertDialog />
    </View>
  );
}

// Memoised so state changes in the parent (e.g. loading flag, editingVocab
// modal toggle) don't trigger a full re-render of the text.
export default memo(HighlightedText);

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    text: {
      fontSize: fontSize.md,
      lineHeight: fontSize.md * 1.6,
      color: c.text,
      fontWeight: '300',
    },
    highlighted: {
      textDecorationLine: 'underline',
      textDecorationColor: c.primary,
      textDecorationStyle: 'solid',
    },
    pickerOverlay: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.xl,
    },
    pickerDialog: {
      width: '100%',
      maxWidth: 340,
      maxHeight: '70%',
      backgroundColor: c.backgroundMid,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      gap: spacing.md,
    },
    pickerTitle: {
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    pickerScroll: {
      maxHeight: 320,
    },
    pickerList: {
      gap: spacing.xs,
    },
    pickerItem: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.sm,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    pickerItemPressed: {
      transform: [{ scale: 0.98 }],
      opacity: 0.85,
    },
    pickerItemText: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '400',
    },
    pickerCancel: {
      padding: spacing.md,
      borderRadius: borderRadius.full,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      alignItems: 'center',
    },
    pickerCancelText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
  });
