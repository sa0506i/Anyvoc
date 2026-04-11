import { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Alert, StyleSheet } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getAllVocabulary,
  updateVocabularyReview,
  deleteVocabulary,
  getVocabularyStats,
  getAllReviewDays,
} from '../../lib/database';
import { getCardsForReview, selectRound, getStreakDays, getBestStreak, getAveragePerDay } from '../../lib/leitner';
import { useTrainerStore } from '../../hooks/useTrainer';
import { useSettingsStore } from '../../hooks/useSettings';
import FlashCard from '../../components/FlashCard';
import LearningMaturity from '../../components/LearningMaturity';
import RecentDays from '../../components/ReviewCalendar';
import EmptyState from '../../components/EmptyState';
import { useTheme } from '../../hooks/useTheme';
import { spacing, fontSize, borderRadius, marineShadow, type ThemeColors } from '../../constants/theme';

export default function TrainerScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const quizDirection = useSettingsStore((s) => s.quizDirection);
  const cardsPerRound = useSettingsStore((s) => s.cardsPerRound);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    currentRound,
    currentIndex,
    isFlipped,
    missedCards,
    isRetryPhase,
    roundComplete,
    roundResults,
    practiceMode,
    startRound,
    flipCard,
    markCorrect,
    markIncorrect,
    nextCard,
    deleteCurrentCard,
    startRetry,
    reset,
    roundDirection,
  } = useTrainerStore();

  const [stats, setStats] = useState<ReturnType<typeof getVocabularyStats> | null>(null);
  const [streak, setStreak] = useState(0);
  const [bestStreakVal, setBestStreakVal] = useState(0);
  const [avgPerDay, setAvgPerDay] = useState(0);
  const [dueCount, setDueCount] = useState(0);
  const [inSession, setInSession] = useState(false);
  const [allReviewDaysList, setAllReviewDaysList] = useState<string[]>([]);

  const refreshStats = useCallback(() => {
    const allVocab = getAllVocabulary(db);
    const vocabStats = getVocabularyStats(db);
    const dueCards = getCardsForReview(allVocab);
    const reviewDays = getAllReviewDays(db);
    setStats(vocabStats);
    setStreak(getStreakDays(allVocab));
    setBestStreakVal(getBestStreak(reviewDays));
    setAvgPerDay(getAveragePerDay(allVocab, reviewDays.length));
    setDueCount(dueCards.length);
    setAllReviewDaysList(reviewDays);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      if (!inSession) refreshStats();
    }, [inSession, refreshStats])
  );

  const handleStartRound = (practice = false) => {
    const allVocab = getAllVocabulary(db);
    let pool;
    if (practice) {
      // Continue-Mode: random selection from entire vocabulary
      pool = [...allVocab].sort(() => Math.random() - 0.5);
    } else {
      pool = getCardsForReview(allVocab);
    }
    const round = selectRound(pool, parseInt(cardsPerRound || '20', 10));
    if (round.length === 0) return;
    startRound(round, quizDirection, practice);
    setInSession(true);
  };

  const handleMark = (correct: boolean) => {
    const result = correct ? markCorrect() : markIncorrect();
    // In practice mode, Leitner boxes and review history are not touched
    if (!practiceMode) {
      updateVocabularyReview(db, result.vocabId, result.newBox, correct);
    }
    nextCard();
  };

  const handleEndSession = () => {
    reset();
    setInSession(false);
    refreshStats();
  };

  const handleDeleteDuringTraining = () => {
    Alert.alert(
      'Delete Card',
      'Remove this word from your vocabulary?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const vocabId = deleteCurrentCard();
            deleteVocabulary(db, vocabId);
          },
        },
      ]
    );
  };

  // Active training session
  if (inSession && !roundComplete && currentRound.length > 0) {
    const card = currentRound[currentIndex];
    const front = roundDirection === 'original' ? card.original : card.translation;
    const back = roundDirection === 'original' ? card.translation : card.original;

    return (
      <View style={styles.container}>
        <View style={styles.progressBar}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressText}>
              {currentIndex + 1} / {currentRound.length}
              {isRetryPhase ? ' (Retry)' : ''}
            </Text>
            <Pressable onPress={handleEndSession} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${((currentIndex + 1) / currentRound.length) * 100}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.cardArea}>
          <FlashCard
            front={front}
            back={back}
            isRevealed={isFlipped}
            onReveal={flipCard}
            onCorrect={() => handleMark(true)}
            onIncorrect={() => handleMark(false)}
            onDelete={handleDeleteDuringTraining}
          />
        </View>
      </View>
    );
  }

  // Round complete
  if (inSession && roundComplete) {
    return (
      <View style={styles.container}>
        <View style={styles.resultsContainer}>
          <Ionicons name="trophy-outline" size={64} color={colors.primary} />
          <Text testID="round-complete-text" style={styles.resultsTitle}>Round Complete!</Text>
          <View style={styles.resultsRow}>
            <View style={styles.resultBox}>
              <Text style={[styles.resultNumber, { color: colors.success }]}>
                {roundResults.correct}
              </Text>
              <Text style={styles.resultLabel}>Correct</Text>
            </View>
            <View style={styles.resultBox}>
              <Text style={[styles.resultNumber, { color: colors.error }]}>
                {roundResults.incorrect}
              </Text>
              <Text style={styles.resultLabel}>Wrong</Text>
            </View>
          </View>

          {missedCards.length > 0 && (
            <Pressable style={styles.retryButton} onPress={startRetry}>
              <Text style={styles.retryButtonText}>
                Retry {missedCards.length} missed words
              </Text>
            </Pressable>
          )}

          <Pressable testID="end-session-btn" style={styles.endButton} onPress={handleEndSession}>
            <Text style={styles.endButtonText}>Back to Overview</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // No vocabulary at all → unified empty state, flex-centred
  if (stats && stats.total === 0) {
    return (
      <View style={styles.container}>
        <EmptyState />
      </View>
    );
  }

  // Home / stats view
  return (
    <ScrollView testID="trainer-screen" style={styles.container} contentContainerStyle={styles.homeContent}>
      {/* Statistics */}
      {stats && stats.total > 0 && (
        <>
          <Text style={styles.sectionTitle}>Statistics</Text>
          <View style={styles.statsGrid}>
            <Pressable
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/vocabulary?filter=learnedToday')}
            >
              <Text style={styles.statNumber}>{stats.learnedToday}</Text>
              <Text style={styles.statLabel}>Learned Today</Text>
              {avgPerDay > 0 && (
                <Text style={styles.statSubtitle}>Avg: {avgPerDay}/day</Text>
              )}
            </Pressable>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{streak}</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
              {bestStreakVal > 0 && (
                <Text style={styles.statSubtitle}>Best: {bestStreakVal}</Text>
              )}
            </View>
          </View>

          <RecentDays reviewDays={allReviewDaysList} />

          <Text style={styles.sectionTitle}>Learning Maturity</Text>
          <LearningMaturity
            boxCounts={stats.byBox}
            onBoxPress={(box) => router.push(`/(tabs)/vocabulary?box=${box}`)}
          />
        </>
      )}

      {/* Start button */}
      {dueCount > 0 ? (
        <Pressable testID="start-training-btn" style={styles.startButton} onPress={() => handleStartRound(false)}>
          <Ionicons name="play" size={24} color="#FFFFFF" />
          <Text style={styles.startButtonText}>Start Training ({dueCount} due)</Text>
        </Pressable>
      ) : (
        <Pressable testID="continue-training-btn" style={styles.continueButton} onPress={() => handleStartRound(true)}>
          <Ionicons name="play" size={24} color={colors.textSecondary} />
          <Text style={styles.continueButtonText}>Continue Training (0 due)</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    homeContent: {
      padding: spacing.md,
      gap: spacing.lg,
      paddingBottom: 100,
    },
    startButton: {
      backgroundColor: c.primary,
      borderRadius: borderRadius.full,
      padding: spacing.lg,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.sm,
      ...marineShadow,
    },
    startButtonText: {
      color: '#FFFFFF',
      fontSize: fontSize.lg,
      fontWeight: '600',
    },
    continueButton: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.full,
      padding: spacing.lg,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.sm,
    },
    continueButtonText: {
      color: c.textSecondary,
      fontSize: fontSize.lg,
      fontWeight: '600',
    },
    sectionTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    statCard: {
      flex: 1,
      minWidth: '45%',
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      alignItems: 'center',
      gap: spacing.xs,
      overflow: 'hidden',
    },
    statNumber: {
      fontSize: fontSize.xxl,
      fontWeight: '700',
      color: c.text,
    },
    statLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '300',
    },
    statSubtitle: {
      fontSize: 10,
      color: c.textSecondary,
      fontWeight: '400',
      marginTop: 2,
    },
    // Training session
    progressBar: {
      padding: spacing.md,
      gap: spacing.xs,
    },
    progressHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    progressText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      fontWeight: '300',
    },
    progressTrack: {
      height: 4,
      backgroundColor: c.borderSubtle,
      borderRadius: 2,
    },
    progressFill: {
      height: 4,
      backgroundColor: c.primary,
      borderRadius: 2,
    },
    cardArea: {
      flex: 1,
      justifyContent: 'center',
      padding: spacing.md,
    },
    // Results
    resultsContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.xl,
      gap: spacing.lg,
    },
    resultsTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
    },
    resultsRow: {
      flexDirection: 'row',
      gap: spacing.xl,
    },
    resultBox: {
      alignItems: 'center',
      gap: spacing.xs,
    },
    resultNumber: {
      fontSize: 48,
      fontWeight: '700',
    },
    resultLabel: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '300',
    },
    retryButton: {
      backgroundColor: c.warningBgLight,
      borderWidth: 1,
      borderColor: c.warningBgMedium,
      borderRadius: borderRadius.full,
      padding: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    retryButtonText: {
      color: c.warning,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    endButton: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.full,
      padding: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    endButtonText: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      fontWeight: '300',
    },
  });
