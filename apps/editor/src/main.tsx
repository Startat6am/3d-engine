import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorApp } from './ui/EditorApp.js';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>,
);
