import React from 'react';
import { StyleSheet, View } from 'react-native';
import { topInset } from '../utils/safeArea';
import { LoadingCursor } from './LoadingCursor';

/** Top-left Dashboard wait state when no locally saved cards are available. */
export function HomeLoadingState() {
  return (
    <View style={styles.container}>
      <LoadingCursor />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: topInset + 28, paddingHorizontal: 28 },
});
