import fs from 'fs';
import path from 'path';
import os from 'os';

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) { /* ignore */ }
}

function baseLogDir() {
  const home = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
  const dir = path.join(home, 'Scark', 'logs');
  ensureDir(dir);
  return dir;
}

function filenameFor(name) {
  const date = new Date().toISOString().slice(0, 10);
  const safe = (name || 'app').replace(/[^a-z0-9_-]/ig, '_');
  return path.join(baseLogDir(), `scark-${safe}-${date}.log`);
}

function timestamp() {
  return new Date().toISOString();
}

function writeToFile(name, level, msg) {
  try {
    const file = filenameFor(name);
    const line = `${timestamp()} [${level.toUpperCase()}] ${msg}${os.EOL}`;
    fs.appendFileSync(file, line, { encoding: 'utf8' });
  } catch (e) {
    // best-effort logging, don't throw
    // fallback to console
    console.error('[logger] write failed', e?.message || e);
  }
}

export function info(name, msg) {
  console.log(msg);
  writeToFile(name, 'info', msg);
}

export function warn(name, msg) {
  console.warn(msg);
  writeToFile(name, 'warn', msg);
}

export function error(name, msg) {
  console.error(msg);
  writeToFile(name, 'error', msg);
}

export function append(name, text) {
  try {
    const file = filenameFor(name);
    fs.appendFileSync(file, text, { encoding: 'utf8' });
  } catch (e) {
    console.error('[logger] append failed', e?.message || e);
  }
}

export default { info, warn, error, append };
