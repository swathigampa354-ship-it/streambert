const { withAndroidManifest, withMainApplication } = require('@expo/config-plugins');

function withExternalPlayerQueries(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const manifest = androidManifest.manifest;

    // Add queries for video players if not exists
    if (!manifest.queries) {
      manifest.queries = [{}];
    }
    if (!manifest.queries[0].intent) {
      manifest.queries[0].intent = [];
    }
    if (!manifest.queries[0].package) {
      manifest.queries[0].package = [];
    }

    const videoIntents = [
      { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:mimeType': 'video/*' } }] },
      { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:mimeType': 'video/mp4' } }] },
      { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:mimeType': 'application/x-mpegURL' } }] },
      { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:mimeType': 'application/vnd.apple.mpegurl' } }] },
    ];

    // Must stay in sync with knownPlayerPackages in
    // modules/expo-external-player/android/.../ExternalPlayerModule.kt
    // (PackageManager.getPackageInfo is blocked by package-visibility rules
    // on Android 11+ unless the package is declared in <queries>)
    const knownPackages = [
      'org.videolan.vlc',
      'org.videolan.vlc.debug',
      'is.xyz.mpv',
      'is.xyz.mpv.debug',
      'com.mpv',
      'com.mxtech.videoplayer.ad',
      'com.mxtech.videoplayer.pro',
      'com.brouken.player',
      'com.anotherwidget.justplayer',
      'dev.anotherwidget.ftp',
      'dev.anishaneja.nextplayer',
      'org.courville.nova',
      'org.xbmc.kodi'
    ];

    // Merge intents
    for (const intent of videoIntents) {
      const exists = manifest.queries[0].intent.some(i => 
        JSON.stringify(i) === JSON.stringify(intent)
      );
      if (!exists) {
        manifest.queries[0].intent.push(intent);
      }
    }

    // Merge packages
    for (const pkg of knownPackages) {
      const exists = manifest.queries[0].package.some(p => p.$['android:name'] === pkg);
      if (!exists) {
        manifest.queries[0].package.push({ $: { 'android:name': pkg } });
      }
    }

    return config;
  });
}

function withExternalPlayerPermissions(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const manifest = androidManifest.manifest;

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    // Scoped storage: legacy storage permissions must NEVER ship unbounded.
    // WRITE/READ applies to API<=28 / <=32 only (Kotlin uses MediaStore above).
    const SDK_CAPS = {
      'android.permission.WRITE_EXTERNAL_STORAGE': '28',
      'android.permission.READ_EXTERNAL_STORAGE': '32',
    };
    const permissions = [
      'android.permission.INTERNET',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_VIDEO'
    ];

    for (const perm of permissions) {
      const entry = manifest['uses-permission'].find(p => p.$['android:name'] === perm);
      const cap = SDK_CAPS[perm];
      if (entry) {
        // exists (e.g. from template or another library): enforce the cap
        if (cap) entry.$['android:maxSdkVersion'] = cap;
      } else {
        manifest['uses-permission'].push(cap
          ? { $: { 'android:name': perm, 'android:maxSdkVersion': cap } }
          : { $: { 'android:name': perm } });
      }
    }

    return config;
  });
}

module.exports = function withExternalPlayer(config) {
  config = withExternalPlayerPermissions(config);
  config = withExternalPlayerQueries(config);
  return config;
};
