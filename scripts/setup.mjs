import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 5)) { console.error('Node 22.5+ is required (you have ' + process.version + ').'); process.exit(1); }
for (const d of ['server', 'client']) if (!existsSync(`${d}/.env`)) { copyFileSync(`${d}/.env.example`, `${d}/.env`); console.log(`created ${d}/.env`); }
for (const d of ['.', 'server', 'client']) { console.log(`\n> npm install (${d})`); execSync('npm install', { cwd: d, stdio: 'inherit' }); }
console.log('\nAll set. Start everything with:  npm run dev   then open http://localhost:5173');
