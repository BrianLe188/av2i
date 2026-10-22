import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@xyflow/react/dist/style.css';
import './index.css';
import './styles.css';
import { App } from './App';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

// shadcn themes with a `dark` class on <html>; follow the system setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  </StrictMode>,
);
