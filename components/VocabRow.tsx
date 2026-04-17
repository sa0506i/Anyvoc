import { memo, useCallback } from 'react';
import type { Vocabulary } from '../lib/database';
import VocabCard from './VocabCard';
import SwipeToDelete from './SwipeToDelete';

interface VocabRowProps {
  item: Vocabulary;
  onDelete: (item: Vocabulary) => void;
  onEdit: (item: Vocabulary) => void;
}

// Memoized row wrapper used by both the main vocabulary tab and the
// content-detail vocabulary list. Keeps the FlatList's per-row tree
// stable across unrelated parent renders (edit-modal close, filter
// recompute, etc) so VocabCard's memo actually pays off.
function VocabRowImpl({ item, onDelete, onEdit }: VocabRowProps) {
  const handleDelete = useCallback(() => onDelete(item), [item, onDelete]);
  const handleEdit = useCallback(() => onEdit(item), [item, onEdit]);

  return (
    <SwipeToDelete onDelete={handleDelete} onEdit={handleEdit}>
      <VocabCard
        original={item.original}
        translation={item.translation}
        level={item.level}
        wordType={item.word_type}
        leitnerBox={item.leitner_box}
      />
    </SwipeToDelete>
  );
}

const VocabRow = memo(VocabRowImpl);
export default VocabRow;
