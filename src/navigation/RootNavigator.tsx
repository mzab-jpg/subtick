// ============================================================
// SubTick — Root Stack Navigator
// ============================================================

import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackParamList } from '../types';

// Screens (lazy imports for code splitting)
import OnboardingScreen from '../screens/OnboardingScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ReaderScreen from '../screens/ReaderScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SavedReadsScreen from '../screens/SavedReadsScreen';
import CategoryPreferencesScreen from '../screens/CategoryPreferencesScreen';
import DashboardStatsScreen from '../screens/DashboardStatsScreen';
import DeveloperOptionsScreen from '../screens/DeveloperOptionsScreen';
import FeedbackScreen from '../screens/FeedbackScreen';
import FeedRequestScreen from '../screens/FeedRequestScreen';

const Stack = createStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { colors, isDark } = useTheme();

  // Build navigation theme from our colors
  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
      notification: colors.accent,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Dashboard"
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: colors.background },
          presentation: 'card',
          gestureEnabled: false, // We handle swipes manually in Reader
        }}
      >
        <Stack.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ gestureEnabled: false, headerLeft: () => null }}
        />
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ gestureEnabled: false }}
        />
        <Stack.Screen
          name="Reader"
          component={ReaderScreen}
          options={{
            gestureEnabled: false,
            cardStyleInterpolator: ({ current, layouts }) => ({
              cardStyle: {
                transform: [
                  {
                    translateY: current.progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [layouts.screen.height, 0],
                    }),
                  },
                ],
              },
            }),
          }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            presentation: 'modal',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
          }}
        />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{ gestureEnabled: true }}
        />
        <Stack.Screen
          name="SavedReads"
          component={SavedReadsScreen}
          options={{ gestureEnabled: true }}
        />
        <Stack.Screen
          name="CategoryPreferences"
          component={CategoryPreferencesScreen}
          options={{ gestureEnabled: true }}
        />
        <Stack.Screen
          name="DashboardStats"
          component={DashboardStatsScreen}
          options={{ gestureEnabled: true }}
        />
        <Stack.Screen
          name="DeveloperOptions"
          component={DeveloperOptionsScreen}
          options={{ gestureEnabled: true }}
        />
        <Stack.Screen
          name="Feedback"
          component={FeedbackScreen}
          options={{
            presentation: 'modal',
            gestureEnabled: true,
            gestureDirection: 'vertical',
          }}
        />
        <Stack.Screen
          name="FeedRequest"
          component={FeedRequestScreen}
          options={{
            presentation: 'modal',
            gestureEnabled: true,
            gestureDirection: 'vertical',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}