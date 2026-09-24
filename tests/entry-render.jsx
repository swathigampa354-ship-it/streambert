// Test entry: mounts the REAL Streambert App into the (jsdom) #root.
// Bundled by tests/test_frontend_render.mjs with esbuild (single React copy).
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
window.__streambertTestRoot = root;
