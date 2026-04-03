import { Tabs, useRouter } from 'expo-router';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { ComponentProps } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { useSettingsStore } from '../../hooks/useSettings';
import { useUIStore } from '../../hooks/useUIStore';
import { getLanguageFlag } from '../../constants/languages';
import { spacing, type ThemeColors } from '../../constants/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

// Tab icon map
const TAB_ICONS: Record<string, { active: IoniconsName; inactive: IoniconsName }> = {
  content:    { active: 'document-text',    inactive: 'document-text-outline' },
  index:      { active: 'school',           inactive: 'school-outline' },
  vocabulary: { active: 'list',             inactive: 'list-outline' },
};

function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createTabBarStyles(colors, isDark);
  const requestAddMenu = useUIStore((s) => s.requestAddMenu);

  const handleAdd = () => {
    // Navigate to content tab first, then trigger the add menu
    navigation.navigate('content');
    // Small delay to allow navigation to settle before opening modal
    setTimeout(() => requestAddMenu(), 50);
  };

  return (
    <LinearGradient
      colors={isDark
        ? ['rgba(10, 22, 40, 0)', 'rgba(10, 22, 40, 0.5)', 'rgba(10, 22, 40, 1)']
        : ['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0.5)', 'rgba(255, 255, 255, 1)']}
      locations={[0, 0.35, 0.7]}
      style={[styles.wrapper, { paddingBottom: insets.bottom }]}
    >
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const label = options.title ?? route.name;
          const icons = TAB_ICONS[route.name] ?? { active: 'ellipse' as IoniconsName, inactive: 'ellipse-outline' as IoniconsName };

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.tabItem}
            >
              <Ionicons
                name={isFocused ? icons.active : icons.inactive}
                size={22}
                color={isFocused ? '#FFFFFF' : colors.textSecondary}
              />
              <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}

        {/* Add as 4th tab item */}
        <Pressable onPress={handleAdd} style={styles.tabItem}>
          <Ionicons name="add-outline" size={22} color={colors.textSecondary} />
          <Text style={styles.tabLabel}>Add</Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const createTabBarStyles = (c: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    wrapper: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
    },
    bar: {
      flexDirection: 'row',
      paddingTop: spacing.sm,
    },
    tabItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
      gap: 3,
    },
    tabLabel: {
      fontSize: 10,
      fontWeight: '400',
      color: c.textSecondary,
      letterSpacing: 0.2,
    },
    tabLabelActive: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
  });

function HeaderTitle({ colors }: { colors: ThemeColors }) {
  return (
    <View style={headerStyles.container}>
      <Text style={[headerStyles.brand, { color: colors.text }]}>any</Text>
      <Text style={[headerStyles.brand, headerStyles.accent, { color: colors.primary }]}>voc</Text>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'baseline' },
  brand: { fontSize: 22, fontWeight: '300', letterSpacing: -0.5 },
  accent: { fontWeight: '700' },
});

export default function TabLayout() {
  const router = useRouter();
  const { colors } = useTheme();
  const learningLanguage = useSettingsStore((s) => s.learningLanguage);
  const flag = getLanguageFlag(learningLanguage);

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerLeft: () => (
          <Text style={{ fontSize: 22, marginLeft: 16 }}>{flag}</Text>
        ),
        headerStyle: { backgroundColor: colors.backgroundMid },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerRight: () => (
          <Pressable onPress={() => router.push('/settings')} style={{ marginRight: 16 }}>
            <Ionicons name="settings-outline" size={24} color={colors.text} />
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen
        name="content"
        options={{ headerTitle: () => <HeaderTitle colors={colors} />, title: 'Content' }}
      />
      <Tabs.Screen
        name="index"
        options={{ headerTitle: () => <HeaderTitle colors={colors} />, title: 'Trainer' }}
      />
      <Tabs.Screen
        name="vocabulary"
        options={{ headerTitle: () => <HeaderTitle colors={colors} />, title: 'Vocabulary' }}
      />
    </Tabs>
  );
}
