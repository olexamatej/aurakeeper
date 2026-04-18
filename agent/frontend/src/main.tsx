import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ThemeProvider } from './components/ThemeProvider'
import { SettingsProvider } from './components/SettingsProvider'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </ThemeProvider>
  </StrictMode>,
)
