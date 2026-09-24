const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withExternalPlayerNative(config) {
  config = withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const androidRoot = path.join(projectRoot, 'android');
    
    // Source files from modules/
    const srcModuleRoot = path.join(projectRoot, 'modules', 'expo-external-player', 'android', 'src', 'main', 'java', 'expo', 'modules', 'externalplayer');
    const destModuleRoot = path.join(androidRoot, 'app', 'src', 'main', 'java', 'expo', 'modules', 'externalplayer');
    
    // Ensure dest exists
    if (!fs.existsSync(destModuleRoot)) {
      fs.mkdirSync(destModuleRoot, { recursive: true });
    }
    
    // Copy Java/Kotlin files if source exists
    if (fs.existsSync(srcModuleRoot)) {
      const files = fs.readdirSync(srcModuleRoot);
      for (const file of files) {
        const srcFile = path.join(srcModuleRoot, file);
        const destFile = path.join(destModuleRoot, file);
        if (fs.statSync(srcFile).isFile()) {
          const content = fs.readFileSync(srcFile, 'utf-8');
          fs.writeFileSync(destFile, content);
          console.log(`[with-external-player-native] Copied ${file} to ${destModuleRoot}`);
        }
      }
    } else {
      console.warn(`[with-external-player-native] Source not found: ${srcModuleRoot}`);
    }
    
    return config;
  }]);
  
  return config;
}

module.exports = withExternalPlayerNative;
