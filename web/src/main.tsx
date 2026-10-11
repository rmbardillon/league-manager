import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Mantine styles first, then app-level tweaks so app selectors win (Req 10.1).
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { ColorSchemeScript } from '@mantine/core';
import { App } from './App.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    {/* Sets the initial color scheme before paint; the provider lives in App. */}
    <ColorSchemeScript defaultColorScheme="dark" />
    <App />
  </StrictMode>,
);
