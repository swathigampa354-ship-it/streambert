// Desktop platform implementation - wraps window.electron
// This preserves all existing desktop functionality

const electron = () => {
  if (typeof window !== 'undefined' && window.electron) return window.electron;
  return null;
};

const desktopPlatform = {
  async getAppVersion() {
    const e = electron();
    if (e?.getAppVersion) return e.getAppVersion();
    return '2.6.0';
  },

  async getPlatform() {
    const e = electron();
    if (e?.getPlatform) return e.getPlatform();
    return 'desktop';
  },

  async getDownloads() {
    const e = electron();
    if (e?.getDownloads) return e.getDownloads();
    return [];
  },

  async deleteDownload(args) {
    const e = electron();
    if (e?.deleteDownload) return e.deleteDownload(args);
  },

  async checkDownloader(folder) {
    const e = electron();
    if (e?.checkDownloader) return e.checkDownloader(folder);
    return { available: false };
  },

  async runDownload(args) {
    const e = electron();
    if (e?.runDownload) return e.runDownload(args);
  },

  async fileExists(path) {
    const e = electron();
    if (e?.fileExists) return e.fileExists(path);
    return false;
  },

  async showInFolder(path) {
    const e = electron();
    if (e?.showInFolder) return e.showInFolder(path);
  },

  async pickFolder() {
    const e = electron();
    if (e?.pickFolder) return e.pickFolder();
    return null;
  },

  async openExternal(url) {
    const e = electron();
    if (e?.openExternal) return e.openExternal(url);
    window.open(url, '_blank');
  },

  async openPath(filePath) {
    const e = electron();
    if (e?.openPath) return e.openPath(filePath);
  },

  async openPathAtTime(filePath, seconds, subtitlePaths) {
    const e = electron();
    if (e?.openPathAtTime) return e.openPathAtTime(filePath, seconds, subtitlePaths);
  },

  async secureGet(key) {
    const e = electron();
    if (e?.secureGet) return e.secureGet(key);
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async secureSet(key, value) {
    const e = electron();
    if (e?.secureSet) return e.secureSet(key, value);
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  async searchSubtitles(args) {
    const e = electron();
    if (e?.searchSubtitles) return e.searchSubtitles(args);
    return [];
  },

  async downloadSubtitlesForFile(args) {
    const e = electron();
    if (e?.downloadSubtitlesForFile) return e.downloadSubtitlesForFile(args);
  },

  async deleteSubtitleFile(args) {
    const e = electron();
    if (e?.deleteSubtitleFile) return e.deleteSubtitleFile(args);
  },

  async getAvailablePlayers() {
    const e = electron();
    if (e?.getAvailablePlayers) return e.getAvailablePlayers();
    return [];
  },

  async launchExternalPlayer(args) {
    const e = electron();
    if (e?.launchExternalPlayer) return e.launchExternalPlayer(args);
    throw new Error('External player not available');
  },

  async startProxyServer(args) {
    const e = electron();
    if (e?.startProxyServer) return e.startProxyServer(args);
  },

  async stopProxyServer() {
    const e = electron();
    if (e?.stopProxyServer) return e.stopProxyServer();
  },

  async getStreamHeaders(args) {
    const e = electron();
    if (e?.getStreamHeaders) return e.getStreamHeaders(args);
    return {};
  },

  async resolveAllManga(args) {
    const e = electron();
    if (e?.resolveAllManga) return e.resolveAllManga(args);
    throw new Error('AllManga resolver not available');
  },

  async showNotification({ title, body, silent }) {
    const e = electron();
    if (e?.showNotification) return e.showNotification({ title, body, silent });
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, silent });
    }
  },

  async windowMinimize() {
    const e = electron();
    if (e?.windowMinimize) return e.windowMinimize();
  },

  async windowToggleMaximize() {
    const e = electron();
    if (e?.windowToggleMaximize) return e.windowToggleMaximize();
  },

  async windowClose() {
    const e = electron();
    if (e?.windowClose) return e.windowClose();
  },

  async getCacheSize() {
    const e = electron();
    if (e?.getCacheSize) return e.getCacheSize();
    return 0;
  },

  async clearAppCache() {
    const e = electron();
    if (e?.clearAppCache) return e.clearAppCache();
  },

  async wyzieOpenRedeem() {
    const e = electron();
    if (e?.wyzieOpenRedeem) return e.wyzieOpenRedeem();
  },

  async wyzieValidateKey(key) {
    const e = electron();
    if (e?.wyzieValidateKey) return e.wyzieValidateKey(key);
    return false;
  },
};

export default desktopPlatform;
