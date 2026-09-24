// Test entry: renders the REAL Sidebar with a spy onToggleTvMode.
// Bundled by tests/test_ui_tv.mjs with esbuild.
import React from 'react';
import { createRoot } from 'react-dom/client';
import Sidebar from '../src/components/Sidebar.jsx';

const props = {
  page: 'home',
  onNavigate: () => {},
  onSearch: () => {},
  savedList: [],
  activeDownloads: 0,
  onReorderSaved: () => {},
  onRemoveSaved: () => {},
  canGoBack: false,
  onBack: () => {},
  onShowShortcuts: () => {},
  tvMode: false,
  onToggleTvMode: () => {
    window.__toggleCalls = (window.__toggleCalls || 0) + 1;
  },
};

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(Sidebar, props));
