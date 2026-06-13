const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const http = require('http');

const API_URL = process.env.API_URL || 'https://jddydrrxnyfusekkjtkb.supabase.co/functions/v1/mining-api';
const MONERO_ADDRESS = process.env.MONERO_ADDRESS || '47uc8GJNqbXGHSQ8ryoHpVPB231HsBQezMgkF8Y6mjgBDseES1QE5Y7UGEE5QsZYfmFGDi6hEwADKhkyDWCYS23BM76GPjx';
const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}`;
const WORKER_API_SECRET = process.env.WORKER_API_SECRET || '';
const XMRIG_PATH = process.env.XMRIG_PATH || './xmrig';
const API_PORT = Number.parseInt(process.env.API_PORT || '8081', 10);
const POOL_URL = process.env.POOL_URL || 'gulf.moneroocean.stream:10128';
const STATS_INTERVAL_MS = Number.parseInt(process.env.STATS_INTERVAL_MS || '10000', 10);

let xmrigProcess = null;
let restartCount = 0;
let isRegistered = false;
let shuttingDown = false;

const hostname = os.hostname();

function requireConfig() {
  const missing = [];
  if (!API_URL) missing.push('API_URL');
  if (!MONERO_ADDRESS) missing.push('MONERO_ADDRESS');
  if (!WORKER_API_SECRET) missing.push('WORKER_API_SECRET');
  if (missing.length > 0) {
    console.error(`[CONFIG] Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function apiFetch(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': WORKER_API_SECRET,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

async function registerWorker() {
  try {
    await apiFetch('/workers/register', {
      moneroAddress: MONERO_ADDRESS,
      workerId: WORKER_ID,
      hostname,
      isLocal: true,
    });
    if (!isRegistered) console.log('[API] Worker registered');
    isRegistered = true;
    return true;
  } catch (error) {
    isRegistered = false;
    console.error('[API] Register error:', error.message);
    return false;
  }
}

async function sendStats(stats) {
  try {
    await apiFetch('/workers/stats', {
      moneroAddress: MONERO_ADDRESS,
      workerId: WORKER_ID,
      hostname,
      stats,
    });
    isRegistered = true;
  } catch (error) {
    isRegistered = false;
    console.error('[API] Stats error:', error.message);
  }
}

function getXmrigStats() {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: API_PORT,
      path: '/2/summary',
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function startXmrig() {
  if (xmrigProcess || shuttingDown) return true;

  if (!fs.existsSync(XMRIG_PATH)) {
    console.error('[XMRig] Binary not found at:', XMRIG_PATH);
    return false;
  }

  console.log('[XMRig] Starting...');

  const args = [
    '--url', POOL_URL,
    '--user', MONERO_ADDRESS,
    '--pass', WORKER_ID,
    '--http-enabled',
    '--http-host', '127.0.0.1',
    '--http-port', String(API_PORT),
    '--no-huge-pages',
  ];

  xmrigProcess = spawn(XMRIG_PATH, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  xmrigProcess.on('exit', (code) => {
    console.error(`[XMRig] Exited with code ${code}`);
    xmrigProcess = null;
    if (!shuttingDown) {
      restartCount += 1;
      console.log(`[XMRig] Restarting in 5s (attempt ${restartCount})`);
      setTimeout(startXmrig, 5000);
    }
  });

  xmrigProcess.on('error', (err) => {
    console.error('[XMRig] Spawn error:', err.message);
    xmrigProcess = null;
  });

  return true;
}

function formatStats(stats) {
  return {
    hashrateRaw: stats.hashrate?.total?.[0] || 0,
    hashrate1m: stats.hashrate?.total?.[1] || 0,
    hashrate15m: stats.hashrate?.total?.[2] || 0,
    sharesGood: stats.results?.shares_good || 0,
    sharesTotal: stats.results?.shares_total || 0,
    ping: stats.connection?.ping || 0,
    uptime: stats.uptime || 0,
    diff: stats.results?.diff_current || 0,
    errors: stats.results?.error_results || 0,
    pool: stats.connection?.pool || 'N/A',
    threads: stats.cpu?.threads || 0,
    version: stats.version || 'N/A',
  };
}

async function statsTick() {
  if (!isRegistered) await registerWorker();

  const stats = await getXmrigStats();
  if (!stats) {
    console.log('[STATS] Waiting for XMRig API...');
    return;
  }

  const formattedStats = formatStats(stats);
  await sendStats(formattedStats);
  console.log(
    `[STATS] ${formattedStats.hashrateRaw.toFixed(2)} H/s | Shares: ${formattedStats.sharesGood} | Pool: ${formattedStats.pool}`,
  );
}

async function main() {
  requireConfig();

  console.log('');
  console.log('========================================');
  console.log('       MINING WORKER - PRODUCTION       ');
  console.log('========================================');
  console.log('[CONFIG] API URL:', API_URL);
  console.log('[CONFIG] Pool:', POOL_URL);
  console.log('[CONFIG] Monero:', `${MONERO_ADDRESS.slice(0, 12)}...${MONERO_ADDRESS.slice(-6)}`);
  console.log('[CONFIG] Worker ID:', WORKER_ID);
  console.log('[CONFIG] Hostname:', hostname);
  console.log('[CONFIG] XMRig API Port:', API_PORT);
  console.log('');

  await registerWorker();

  if (!startXmrig()) {
    console.error('[XMRig] Failed to start.');
    process.exit(1);
  }

  setInterval(statsTick, STATS_INTERVAL_MS);
  setInterval(registerWorker, 60000);
  console.log('[SYSTEM] Worker running. Press Ctrl+C to stop.');
}

function shutdown(signal) {
  shuttingDown = true;
  console.log(`[SYSTEM] ${signal} received, stopping...`);
  if (xmrigProcess) xmrigProcess.kill();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main();
