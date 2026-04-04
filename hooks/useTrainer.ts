import { create } from 'zustand';
import type { Vocabulary } from '../lib/database';
import { promoteBox, demoteBox } from '../lib/leitner';
import type { QuizDirection } from './useSettings';

type ResolvedDirection = 'original' | 'translation';

interface TrainerState {
  currentRound: Vocabulary[];
  currentIndex: number;
  isFlipped: boolean;
  missedCards: Vocabulary[];
  isRetryPhase: boolean;
  roundComplete: boolean;
  roundResults: { correct: number; incorrect: number };
  roundDirection: ResolvedDirection;

  startRound: (cards: Vocabulary[], quizDirection: QuizDirection) => void;
  flipCard: () => void;
  markCorrect: () => { vocabId: string; newBox: number };
  markIncorrect: () => { vocabId: string; newBox: number };
  nextCard: () => void;
  deleteCurrentCard: () => string;
  startRetry: () => void;
  reset: () => void;
}

function resolveDirection(quizDirection: QuizDirection): ResolvedDirection {
  if (quizDirection === 'native-to-learning') return 'translation';
  if (quizDirection === 'learning-to-native') return 'original';
  // 'random': pick once for the entire round
  return Math.random() < 0.5 ? 'original' : 'translation';
}

export const useTrainerStore = create<TrainerState>((set, get) => ({
  currentRound: [],
  currentIndex: 0,
  isFlipped: false,
  missedCards: [],
  isRetryPhase: false,
  roundComplete: false,
  roundResults: { correct: 0, incorrect: 0 },
  roundDirection: 'original',

  startRound: (cards, quizDirection) =>
    set({
      currentRound: shuffle(cards),
      currentIndex: 0,
      isFlipped: false,
      missedCards: [],
      isRetryPhase: false,
      roundComplete: false,
      roundResults: { correct: 0, incorrect: 0 },
      roundDirection: resolveDirection(quizDirection),
    }),

  flipCard: () => set({ isFlipped: true }),

  markCorrect: () => {
    const { currentRound, currentIndex, roundResults } = get();
    const vocab = currentRound[currentIndex];
    const newBox = promoteBox(vocab.leitner_box);
    set({
      roundResults: { ...roundResults, correct: roundResults.correct + 1 },
    });
    return { vocabId: vocab.id, newBox };
  },

  markIncorrect: () => {
    const { currentRound, currentIndex, missedCards, roundResults } = get();
    const vocab = currentRound[currentIndex];
    const newBox = demoteBox();
    set({
      missedCards: [...missedCards, vocab],
      roundResults: { ...roundResults, incorrect: roundResults.incorrect + 1 },
    });
    return { vocabId: vocab.id, newBox };
  },

  nextCard: () => {
    const { currentRound, currentIndex } = get();
    if (currentIndex + 1 >= currentRound.length) {
      set({ roundComplete: true });
    } else {
      set({ currentIndex: currentIndex + 1, isFlipped: false });
    }
  },

  deleteCurrentCard: () => {
    const { currentRound, currentIndex, missedCards } = get();
    const vocab = currentRound[currentIndex];
    const newRound = currentRound.filter((_, i) => i !== currentIndex);
    const newMissed = missedCards.filter((c) => c.id !== vocab.id);

    if (newRound.length === 0) {
      set({ currentRound: newRound, missedCards: newMissed, roundComplete: true });
    } else if (currentIndex >= newRound.length) {
      set({ currentRound: newRound, missedCards: newMissed, roundComplete: true });
    } else {
      set({ currentRound: newRound, missedCards: newMissed, isFlipped: false });
    }
    return vocab.id;
  },

  startRetry: () => {
    const { missedCards, roundDirection } = get();
    set({
      currentRound: shuffle(missedCards),
      currentIndex: 0,
      isFlipped: false,
      missedCards: [],
      isRetryPhase: true,
      roundComplete: false,
      roundResults: { correct: 0, incorrect: 0 },
      // Keep same direction for retry
      roundDirection,
    });
  },

  reset: () =>
    set({
      currentRound: [],
      currentIndex: 0,
      isFlipped: false,
      missedCards: [],
      isRetryPhase: false,
      roundComplete: false,
      roundResults: { correct: 0, incorrect: 0 },
      roundDirection: 'original',
    }),
}));

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
