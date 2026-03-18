import fs from 'fs';
import path from 'path';

function parseEnvFile(content) {
  const lines = content.split(/\r?\n/);
  const result = {};
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

function loadEnvFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf8');
    return parseEnvFile(content);
  } catch (err) {
    console.warn('[envLoader] Failed to load', filePath, err?.message || err);
    return {};
  }
}

function applyEnv(obj) {
  for (const k of Object.keys(obj)) {
    if (process.env[k] === undefined) process.env[k] = obj[k];
  }
}

// Try APPDATA/Scark/.env, then %LOCALAPPDATA%/Scark/.env, then project .env
const candidates = [];
if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'Scark', '.env'));
if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Scark', '.env'));
candidates.push(path.join(process.cwd(), '.env'));

for (const p of candidates) {
  const obj = loadEnvFromFile(p);
  if (Object.keys(obj).length > 0) {
    console.log('[envLoader] Loaded env from', p);
    applyEnv(obj);
    break;
  }
}

export default null;
