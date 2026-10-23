import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import './styles/command.css';
import { App } from './App';

// The shell goes in first and synchronously: the sections' start-up code reads it, as the
// prototype's script did when it ran at the end of the page.
const root = createRoot(document.getElementById('app')!);
flushSync(() => root.render(<App />));

import('./sections/index').then(({ startup }) => startup());
