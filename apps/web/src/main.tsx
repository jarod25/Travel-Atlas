import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing root element');
}

createRoot(container).render(
  <React.StrictMode>
    <MantineProvider defaultColorScheme="light">
      <ModalsProvider>
        <Notifications position="top-right" />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>,
);
