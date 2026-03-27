import { app } from 'electron';
import path from 'path';

if (app) {
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    // In production (packaged), store the DB in User Data (AppData) to avoid read-only restrictions
    process.env.SQLITE_PATH = path.join(app.getPath('userData'), 'scark.db');
    
    // In production (packaged), use the bundled chroma executable
    process.env.CHROMA_CMD = path.join(process.resourcesPath, 'bin', 'chroma.exe');
    process.env.CHROMA_ARGS = 'run --host 0.0.0.0 --port 8000';
  }
  // In development, do not set these env variables and let the app fall back to
  // the defaults (process.cwd() for SQLite and the global 'chroma' command).
}
