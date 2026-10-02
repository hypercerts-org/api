import { spawn } from 'node:child_process';

function terminateProcess(child, signalName) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signalName);
    else child.kill(signalName);
  } catch {
    // The process may have exited between the timeout/signal and this kill.
  }
}

export function runProcess(command, args, { cwd, env = process.env, stdio = 'inherit', input, timeoutMs, signal, label }) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error(`${label} was aborted`));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio, detached: process.platform !== 'win32' });
    let timedOut = false;
    let abortReason;
    let spawnError;
    let stdinError;
    let stdout = '';
    let stderr = '';
    let forceKillTimer;
    const terminate = () => {
      terminateProcess(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => terminateProcess(child, 'SIGKILL'), 1_000);
      forceKillTimer.unref();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const onAbort = () => {
      abortReason = signal.reason ?? new Error(`${label} was aborted`);
      terminate();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdin?.once('error', (error) => { stdinError = error; });
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (code, childSignal) => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', onAbort);
      if (spawnError) {
        reject(new Error(`Could not run ${label}: ${spawnError.message}`, { cause: spawnError }));
      } else if (timedOut) {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      } else if (abortReason) {
        reject(abortReason);
      } else {
        resolve({ code, signal: childSignal, stdout, stderr, stdinError });
      }
    });
    if (child.stdin) child.stdin.end(input);
  });
}
