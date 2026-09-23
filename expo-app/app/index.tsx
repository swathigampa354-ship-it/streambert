import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Link, useRouter } from 'expo-router';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Streambert Android</Text>
      <Text style={styles.subtitle}>Expo + External Player Integration</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Architecture</Text>
        <Text style={styles.text}>
          Streambert → Android App (Expo) → External Player (VLC/MPV/MX) → Video Plays
        </Text>
        <Text style={styles.textSmall}>
          • Preserves 70% of existing Streambert logic (React components, api.js, PLAYER_SOURCES)
          • Replaces Electron-only parts (30%) with Expo native modules
          • Uses real Android Intent API, PackageManager, ServerSocket proxy
          • No Termux, no Electron, no Node in Android runtime
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Development Tests</Text>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={() => router.push('/player-test')}
        >
          <Text style={styles.buttonText}>🧪 External Player Test (Dev APK)</Text>
        </TouchableOpacity>
        <Text style={styles.buttonHint}>Test PackageManager detection, Intent launch, proxy, subtitles</Text>

        <TouchableOpacity 
          style={[styles.button, styles.buttonSecondary]} 
          onPress={() => router.push('/streambert')}
        >
          <Text style={styles.buttonText}>🎬 Streambert WebView</Text>
        </TouchableOpacity>
        <Text style={styles.buttonHint}>Loads Streambert dist/ in WebView, tests stream resolution</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Player Support</Text>
        <Text style={styles.text}>✅ VLC (org.videolan.vlc)</Text>
        <Text style={styles.text}>✅ MPV (is.xyz.mpv)</Text>
        <Text style={styles.text}>✅ MX Player (com.mxtech.videoplayer.ad/pro)</Text>
        <Text style={styles.text}>✅ Just Player (com.brouken.player)</Text>
        <Text style={styles.text}>✅ System Chooser (fallback)</Text>
        <Text style={styles.textSmall}>Custom players via queryIntentActivities video/*</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Stream Handling</Text>
        <Text style={styles.text}>• Direct MP4/HLS via Intent extras (User-Agent, Referer)</Text>
        <Text style={styles.text}>• Cookie/Auth via local proxy 127.0.0.1:0 /https/host/path</Text>
        <Text style={styles.text}>• HLS rewrite: segments → proxy URLs</Text>
        <Text style={styles.text}>• Range forwarding for seeking</Text>
        <Text style={styles.text}>• Host validation 403 (security)</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Subtitles</Text>
        <Text style={styles.text}>• Download to /sdcard/Download/StreambertSubs/</Text>
        <Text style={styles.text}>• 9 intent extras for compatibility (subtitles_location, subs, sub, etc)</Text>
        <Text style={styles.text}>• VLC, MX, MPV support</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>APIs</Text>
        <Text style={styles.text}>• TMDB (metadata, search)</Text>
        <Text style={styles.text}>• AniList (anime)</Text>
        <Text style={styles.text}>• VidKing, Videasy, VidSrc (embed, no key)</Text>
        <Text style={styles.text}>• AllManga (needs JS port from Node)</Text>
        <Text style={styles.text}>• Wyzie (subtitles, optional)</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Build</Text>
        <Text style={styles.textSmall}>Dev APK: eas build --profile development --platform android</Text>
        <Text style={styles.textSmall}>Production: eas build --profile production --platform android</Text>
        <Text style={styles.textSmall}>See CAPACITOR_ANDROID_SETUP.md and EXPO_ANDROID_ARCHITECTURE_REPORT.md</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Streambert Android — Expo/EAS + Native Bridge</Text>
        <Text style={styles.footerText}>Preserves existing functionality, adds Android compatibility layer</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 20 },
  section: { backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#222' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  text: { fontSize: 14, color: '#ccc', marginBottom: 4, lineHeight: 20 },
  textSmall: { fontSize: 12, color: '#888', marginTop: 8, lineHeight: 16 },
  button: { backgroundColor: '#E50914', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonSecondary: { backgroundColor: '#333', borderWidth: 1, borderColor: '#555' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  buttonHint: { fontSize: 11, color: '#666', marginTop: 4, textAlign: 'center' },
  footer: { marginTop: 20, alignItems: 'center' },
  footerText: { fontSize: 11, color: '#555', textAlign: 'center', marginBottom: 2 },
});
