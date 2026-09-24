// Copies the Vite-built Streambert frontend (expo-app/assets/dist) into the
// Android project's assets dir (android/app/src/main/assets/dist) so the
// WebView can load it via file:///android_asset/dist/index.html with ALL
// relative paths intact (hashed JS chunks reference each other relatively).
//
// assetBundlePatterns does NOT guarantee arbitrary web trees land in
// android_asset/ in EAS builds - this dangerous mod does it deterministically.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function withDistAssets(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const srcDir = path.join(projectRoot, 'assets', 'dist');
    const destDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'dist');

    if (!fs.existsSync(srcDir) || !fs.existsSync(path.join(srcDir, 'index.html'))) {
      throw new Error(
        `[with-dist-assets] ${srcDir} is missing or has no index.html. ` +
        `Build the frontend first: (cd .. && npx vite build) then (bash scripts/sync_frontend.sh)`
      );
    }

    // Clean then copy to avoid stale hashed chunks accumulating
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    copyDir(srcDir, destDir);

    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else files.push(p);
      }
    })(destDir);
    console.log(`[with-dist-assets] Copied ${files.length} frontend files -> android/app/src/main/assets/dist`);
    return config;
  }]);
}

module.exports = withDistAssets;
