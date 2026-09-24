import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

/**
 * Entry route.
 *
 * PRODUCTION: the real app IS the Streambert frontend in the WebView —
 * immediately replace this route with /streambert (no wrapper UI visible).
 *
 * DEV (__DEV__, Metro): keep a small dev menu with links to the WebView and
 * the external-player test harness. Development screens never appear in
 * production navigation.
 */
export default function HomeScreen() {
  const router = useRouter();

  useEffect(() => {
    if (!__DEV__) {
      router.replace('/streambert');
    }
  }, [router]);

  if (!__DEV__) {
    return (
      <View style={styles.bootContainer}>
        <ActivityIndicator size="large" color="#E50914" />
        <Text style={styles.bootText}>Starting Streambert…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Streambert Android (DEV)</Text>
      <Text style={styles.subtitle}>Expo + External Player Integration</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Development Tests</Text>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]}
          onPress={() => router.push('/streambert')}
        >
          <Text style={styles.buttonText}>🎬 Streambert WebView (prod UI)</Text>
        </TouchableOpacity>
        <Text style={styles.buttonHint}>The actual app: packaged Streambert frontend in a WebView.</Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/player-test')}
        >
          <Text style={styles.buttonText}>🧪 External Player Test</Text>
        </TouchableOpacity>
        <Text style={styles.buttonHint}>PackageManager detection, Intent launch, proxy, subtitles.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bootContainer: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  bootText: { color: '#fff', marginTop: 12, fontWeight: 'bold' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { color: '#909090', fontSize: 14, marginBottom: 20 },
  section: { marginBottom: 24, backgroundColor: '#111', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#222' },
  sectionTitle: { color: '#E50914', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  button: { backgroundColor: '#8B0000', padding: 14, borderRadius: 8, marginTop: 8 },
  buttonSecondary: { backgroundColor: '#1a5c1a' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15, textAlign: 'center' },
  buttonHint: { color: '#909090', fontSize: 12, marginTop: 4, marginBottom: 8 },
});
