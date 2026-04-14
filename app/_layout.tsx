import { Suspense, useEffect, useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ShareIntentProvider } from 'expo-share-intent';
import { initDatabase, getSetting } from '../lib/database';
import { useSettingsActions, useSettingsStore } from '../hooks/useSettings';
import { useAuthStore } from '../lib/authStore';
import { useTheme } from '../hooks/useTheme';
import { darkColors, type ThemeColors } from '../constants/theme';
import ShareIntentHandler from '../components/ShareIntentHandler';
import GlobalLoadingOverlay from '../components/GlobalLoadingOverlay';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: darkColors.background }}>
      <SafeAreaProvider>
        <Suspense fallback={<LoadingScreen />}>
          <SQLiteProvider databaseName="anyvoc.db" onInit={initDatabase}>
            <RootNavigator />
          </SQLiteProvider>
        </Suspense>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { loadSettings } = useSettingsActions();
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const authLoading = useAuthStore((s) => s.isLoading);
  const isAuthed = useAuthStore((s) => s.isAuthed);
  const db = useSQLiteContext();
  const router = useRouter();
  const segments = useSegments();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const navigationTheme = useMemo(
    () => ({
      ...DarkTheme,
      dark: true,
      colors: {
        ...DarkTheme.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.backgroundMid,
        text: colors.text,
        border: colors.glassBorder,
        notification: colors.primary,
      },
    }),
    [colors],
  );

  useEffect(() => {
    loadSettings();
    restoreSession();
  }, []);

  // Gate: once settings + auth have resolved, route unseen-onboarding
  // guests to the welcome screen. Grandfathered installs have
  // onboarding_seen='true' set by the DB migration, so they skip this.
  useEffect(() => {
    if (!settingsLoaded || authLoading) return;
    const onboardingSeen = getSetting(db, 'onboarding_seen') === 'true';
    const inAuthGroup = segments[0] === 'auth';
    if (!onboardingSeen && !isAuthed && !inAuthGroup) {
      router.replace('/auth/welcome');
    }
  }, [settingsLoaded, authLoading, isAuthed, segments, db, router]);

  // Hide everything until both bootstraps finish — prevents a flash of
  // (tabs) before the welcome redirect can fire.
  if (!settingsLoaded || authLoading) {
    return <LoadingScreen />;
  }

  return (
    <ShareIntentProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.backgroundMid },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="+not-found" options={{ headerShown: false }} />
          <Stack.Screen
            name="settings"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="content/[id]"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="auth/welcome"
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen name="auth/login" options={{ headerShown: false }} />
          <Stack.Screen name="auth/verify" options={{ headerShown: false }} />
        </Stack>

        <ShareIntentHandler />
        <GlobalLoadingOverlay />
      </ThemeProvider>
    </ShareIntentProvider>
  );
}

function LoadingScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    loading: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.background,
    },
  });
