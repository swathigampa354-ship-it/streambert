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

    const knownPackages = [
      'org.videolan.vlc',
      'org.videolan.vlc.debug',
      'is.xyz.mpv',
      'is.xyz.mpv.debug',
      'com.mxtech.videoplayer.ad',
      'com.mxtech.videoplayer.pro',
      'com.brouken.player',
      'dev.anotherwidget.ftp',
      'com.anotherwidget.justplayer',
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

    const permissions = [
      'android.permission.INTERNET',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_VIDEO'
    ];

    for (const perm of permissions) {
      const exists = manifest['uses-permission'].some(p => p.$['android:name'] === perm);
      if (!exists) {
        // For WRITE/READ_EXTERNAL_STORAGE, add maxSdkVersion
        if (perm === 'android.permission.WRITE_EXTERNAL_STORAGE') {
          manifest['uses-permission'].push({ $: { 'android:name': perm, 'android:maxSdkVersion': '28' } });
        } else if (perm === 'android.permission.READ_EXTERNAL_STORAGE') {
          manifest['uses-permission'].push({ $: { 'android:name': perm, 'android:maxSdkVersion': '32' } });
        } else {
          manifest['uses-permission'].push({ $: { 'android:name': perm } });
        }
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
