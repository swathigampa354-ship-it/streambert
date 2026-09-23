# Android Capacitor Reference (DEPRECATED)

This folder contains the previous Capacitor Android implementation.

**Status: DEPRECATED — Final authoritative architecture is expo-app/ (Expo/EAS)**

This Capacitor implementation is kept as reference for Java code (ExternalPlayerPlugin.java, AndroidProxyServer.java) which was adapted to Expo native module in expo-app/modules/expo-external-player/.

**Why deprecated:**
- User has Expo/EAS access and token, not Capacitor
- Expo allows early dev APK via EAS Build, better for Play Store
- Single authoritative architecture required per task

**Java files reused in Expo:**
- ExternalPlayerPlugin.java → adapted to ExternalPlayerModule.kt (Expo)
- AndroidProxyServer.java → reused as is (Map instead of JSObject for Expo)

**If you need to build Capacitor APK (for reference):**
```bash
npx vite build
npx cap copy android
cd android
./gradlew assembleDebug
```

**For final production, use expo-app/ (Expo):**
```bash
cd expo-app
npm install
eas build --profile development --platform android
```

See EXPO_ANDROID_ARCHITECTURE_REPORT.md and ARCHITECTURE_DECISION.md for details.
