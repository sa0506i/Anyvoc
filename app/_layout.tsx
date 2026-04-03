import { Suspense, useEffect, useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ShareIntentProvider } from 'expo-share-intent';
import { initDatabase } from '../lib/database';
import { useSettings } from '../hooks/useSettings';
import { useTheme } from '../hooks/useTheme';
import { darkColors, type ThemeColors } from '../constants/theme';

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
  const { loadSettings } = useSettings();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const navigationTheme = useMemo(() => ({
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
  }), [colors]);

  useEffect(() => {
    loadSettings();
  }, []);

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
            title: 'Settings',
            presentation: 'modal',
            headerStyle: { backgroundColor: colors.backgroundMid },
            headerTintColor: colors.text,
          }}
        />
        <Stack.Screen
          name="content/[id]"
          options={{
            title: 'Content',
            presentation: 'modal',
            headerStyle: { backgroundColor: colors.backgroundMid },
            headerTintColor: colors.text,
          }}
        />
      </Stack>

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
