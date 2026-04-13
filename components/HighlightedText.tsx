import { useMemo } from 'react';
import { Text, Alert, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { fontSize, type ThemeColors } from '../constants/theme';

interface HighlightRange {
  start: number;
  end: number;
  vocabId: string;
}

interface HighlightedTextProps {
  text: string;
  highlights: HighlightRange[];
  onRemoveHighlight: (vocabId: string) => void;
  onAddWord: (word: string) => void;
}

export default function HighlightedText({
  text,
  highlights,
  onRemoveHighlight,
  onAddWord,
}: HighlightedTextProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const sortedHighlights = [...highlights].sort((a, b) => a.start - b.start);

  // Build segments: highlighted spans and plain text between them
  const segments: { text: string; highlight?: HighlightRange }[] = [];
  let lastEnd = 0;

  for (const h of sortedHighlights) {
    if (h.start > lastEnd) {
      segments.push({ text: text.substring(lastEnd, h.start) });
    }
    segments.push({ text: text.substring(h.start, h.end), highlight: h });
    lastEnd = h.end;
  }
  if (lastEnd < text.length) {
    segments.push({ text: text.substring(lastEnd) });
  }

  const handleHighlightPress = (vocabId: string, word: string) => {
    Alert.alert('Remove Vocabulary', `Remove "${word}" from the vocabulary list?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onRemoveHighlight(vocabId) },
    ]);
  };

  const handleWordLongPress = (word: string) => {
    // Strip punctuation from the word for adding
    const cleaned = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!cleaned) return;
    onAddWord(cleaned);
  };

  // Split plain text into individual words (preserving whitespace/punctuation)
  // so each word gets its own long-press target
  const renderPlainSegment = (segmentText: string, keyPrefix: string) => {
    // Split into tokens: words and non-word separators
    const tokens = segmentText.match(/[\p{L}\p{N}]+(?:['']\p{L}+)*|[^\p{L}\p{N}]+/gu) || [];
    return tokens.map((token, j) => {
      const isWord = /\p{L}/u.test(token);
      if (isWord) {
        return (
          <Text key={`${keyPrefix}-${j}`} onLongPress={() => handleWordLongPress(token)}>
            {token}
          </Text>
        );
      }
      return <Text key={`${keyPrefix}-${j}`}>{token}</Text>;
    });
  };

  return (
    <Text style={styles.text}>
      {segments.map((seg, i) =>
        seg.highlight ? (
          <Text
            key={i}
            style={styles.highlighted}
            onPress={() => handleHighlightPress(seg.highlight!.vocabId, seg.text)}
          >
            {seg.text}
          </Text>
        ) : (
          renderPlainSegment(seg.text, String(i))
        ),
      )}
    </Text>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    text: {
      fontSize: fontSize.md,
      lineHeight: fontSize.md * 1.6,
      color: c.text,
      fontWeight: '300',
    },
    highlighted: {
      backgroundColor: c.highlight,
      borderRadius: 4,
    },
  });
