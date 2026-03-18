import ServiceManager from '../lib/ServiceManager.js';
import { spawn } from 'child_process';
import path from 'path';
import logger from '../lib/logger.js';

const CHROMA_URL = process.env.CHROMA_URL || `http://localhost:${process.env.CHROMA_PORT || '8000'}`;
const CHROMA_HEARTBEAT_PATHS = (process.env.CHROMA_HEARTBEAT_PATHS || '/api/v2/heartbeat,/api/v1/heartbeat')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

async function isChromaReachable() {
  for (const pathPart of CHROMA_HEARTBEAT_PATHS) {
    try {
      const res = await fetch(`${CHROMA_URL}${pathPart}`);
      if (res.ok) return true;
    } catch {
      // Keep trying other configured heartbeat endpoints.
    }
  }
  return false;
}

function splitCliArgs(input) {
  if (!input || !input.trim()) return [];
  const parts = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts.map((part) => {
    const quoted =
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"));
    return quoted ? part.slice(1, -1) : part;
  });
}

function normalizeChromaArgs(cmd, args) {
  const base = path.basename(cmd || '').toLowerCase();
  const directChroma = base === 'chroma' || base === 'chroma.exe' || base === 'chromadb' || base === 'chromadb.exe';
  const mentionsChromadb = args.some((a) => String(a).toLowerCase() === 'chromadb');
  if (!directChroma && !mentionsChromadb) return args;

  let seenRun = false;
  return args.filter((arg) => {
    if (String(arg).toLowerCase() !== 'run') return true;
    if (!seenRun) {
      seenRun = true;
      return true;
    }
    return false;
  });
}

// Register a chroma service that can be started/stopped by ServiceManager.
ServiceManager.registerService('chroma', {
  autoStart: true,
  dependencies: [],
  startTimeoutMs: 20000,
  readyTimeoutMs: parseInt(process.env.CHROMA_READY_TIMEOUT_MS || '12000', 10),
  check: async () => isChromaReachable(),
  start: async () => {
    if (await isChromaReachable()) {
      console.log('[chromaLauncher] Existing Chroma instance detected, skipping spawn.');
      return { launched: false, external: true };
    }

    // Only auto-start if configured
    const auto = (process.env.CHROMA_AUTO_START || '').toLowerCase();
    if (!(auto === '1' || auto === 'true')) {
      console.log('[chromaLauncher] CHROMA_AUTO_START not set - skipping auto-launch.');
      return { launched: false };
    }

    const cmdEnv = process.env.CHROMA_CMD || ''; // executable and optional args
    const argsEnv = process.env.CHROMA_ARGS || ''; // additional args
    let cmd, args;
    if (cmdEnv.trim()) {
      const parts = splitCliArgs(cmdEnv);
      cmd = parts[0];
      args = parts.slice(1);
      if (argsEnv.trim()) {
        args = args.concat(splitCliArgs(argsEnv));
      }
      args = normalizeChromaArgs(cmd, args);
    } else {
      cmd = 'chroma';
      args = ['run', '--host', '0.0.0.0', '--port', process.env.CHROMA_PORT || '8000'];
    }

    console.log(`[chromaLauncher] Starting Chroma with: ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
      shell: false,
    });

    proc.on('error', (err) => {
      console.error('[chromaLauncher] Failed to spawn Chroma process:', err);
    });

    proc.on('exit', (code, signal) => {
      logger.info('chroma', `[chromaLauncher] Chroma process exited (code=${code}, signal=${signal}).`);
    });

    // Pipe stdout/stderr into log file and console
    proc.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      logger.append('chroma', text);
    });
    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      logger.append('chroma', text);
    });

    // Quick local readiness probe with exponential backoff so start() only
    // returns after a short warm-up window when possible.
    const localWaitMs = parseInt(process.env.CHROMA_LOCAL_WAIT_MS || '5000', 10);
    if (localWaitMs > 0) {
      const deadline = Date.now() + localWaitMs;
      let delay = 200;
      while (Date.now() < deadline) {
        try {
          if (await isChromaReachable()) {
            console.log('[chromaLauncher] Chroma responding after spawn.');
            break;
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(1000, delay * 2);
      }
    }

    // return process handle so ServiceManager can stop it later
    return { launched: true, procPid: proc.pid, proc, url: CHROMA_URL };
  },

  stop: async (meta) => {
    if (!meta || !meta.launched) return;
    const p = meta.proc;
    if (p && !p.killed) {
      try {
        p.kill();
        console.log('[chromaLauncher] Sent kill to Chroma process.');
      } catch (err) {
        console.error('[chromaLauncher] Error killing Chroma process:', err);
      }
    }
  }
});

export default null;
