// Loads server/.env using Node's built-in loader (no dotenv needed).
try { process.loadEnvFile(); } catch { /* no .env file: defaults apply */ }
