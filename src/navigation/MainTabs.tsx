// ============================================================
// Tangent — Main Tabs (FEED / STACKS / TUNING)
// The three permanent rooms of the new UI. Custom tab bar per the
// Obsidian Steel Glacier spec: 92% obsidian surface, 1px top hairline,
// active tab = steel icon + silver label + accent pip, JetBrains Mono
// uppercase labels. Pushed stack screens (Reader, Settings, …) cover it.
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  BookOpen,
  Layers,
  SlidersHorizontal,
} from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { MainTabParamList } from '../types';
import { monoLabel } from '../utils/constants';
import DashboardScreen from '../screens/DashboardScreen';
import StacksScreen from '../screens/StacksScreen';
import TuningScreen from '../screens/TuningScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICON_SIZE = 22;
const LABEL_SIZE = 9;

const TAB_ITEMS = [
  { name: 'Feed', label: 'FEED', Icon: BookOpen },
  { name: 'Stacks', label: 'STACKS', Icon: Layers },
  { name: 'Tuning', label: 'TUNING', Icon: SlidersHorizontal },
] as const;

function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { colors, fonts } = useTheme();

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: 'rgba(12, 14, 18, 0.92)',
          borderTopColor: '#1E232B',
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {TAB_ITEMS.map((item, index) => {
        const route = state.routes[index];
        const active = state.index === index;
        const color = active ? colors.accent : '#8E9194';
        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(item.name, undefined);
          }
        };

        return (
          <TouchableOpacity
            key={item.name}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={`${item.label} tab`}
            style={styles.tabButton}
            activeOpacity={0.7}
            onPress={onPress}
          >
            <item.Icon size={ICON_SIZE} color={color} strokeWidth={active ? 2 : 1.6} />
            <Text
              style={[
                monoLabel(fonts),
                styles.tabLabel,
                { fontSize: LABEL_SIZE, color: active ? colors.text : '#8E9194' },
              ]}
            >
              {item.label}
            </Text>
            <View
              style={[
                styles.pip,
                { backgroundColor: active ? colors.accent : 'transparent' },
              ]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      initialRouteName="Feed"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarHideOnKeyboard: true,
      }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Feed" component={DashboardScreen} />
      <Tab.Screen name="Stacks" component={StacksScreen} />
      <Tab.Screen name="Tuning" component={TuningScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
    minHeight: 54,
  },
  tabLabel: {
    lineHeight: 12,
  },
  pip: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 1,
  },
});