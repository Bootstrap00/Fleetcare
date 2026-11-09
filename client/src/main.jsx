import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import App from './App';
import './styles.css';
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
createRoot(document.getElementById('root')).render(<App />);
