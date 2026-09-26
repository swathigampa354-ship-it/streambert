const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withKotlinPlugin(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.contents.includes('org.jetbrains.kotlin.android')) {
      return config;
    }

    const kotlinVersion = '1.9.22';
    const injection = `
buildscript {
    ext.kotlin_version = '${kotlinVersion}'
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlinVersion}"
    }
}

plugins {
    id 'org.jetbrains.kotlin.android' version '${kotlinVersion}' apply false
}
`;
    config.modResults.contents = injection + '\n' + config.modResults.contents;
    return config;
  });
};
