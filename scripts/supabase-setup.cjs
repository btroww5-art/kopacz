const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const { mkdirSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');

const required = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_PASSWORD',
];

const rootDir = resolve(__dirname, '..');
const runtimeDir = join(rootDir, '.runtime');
const generatedEnvPath = join(runtimeDir, 'generated-env.json');

function missingEnv() {
  return required.filter((key) => !process.env[key]);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[supabase-setup] ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
      ...options,
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function supabase(args) {
  await run('npx', ['supabase@latest', ...args]);
}

async function main() {
  if (process.env.SKIP_SUPABASE_SETUP === 'true') {
    console.log('[supabase-setup] Skipped by SKIP_SUPABASE_SETUP=true');
    return;
  }

  const missing = missingEnv();
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const inferredProjectRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1] || '';
  const projectRef = process.env.SUPABASE_PROJECT_REF || inferredProjectRef;
  const adminEmails = process.env.ADMIN_EMAILS || '';
  const workerApiSecret = process.env.WORKER_API_SECRET || randomBytes(48).toString('hex');
  const apiUrl = process.env.API_URL || (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/mining-api` : `https://${projectRef}.supabase.co/functions/v1/mining-api`);

  if (!projectRef) {
    throw new Error('Missing SUPABASE_PROJECT_REF and could not infer it from SUPABASE_URL.');
  }

  await supabase(['link', '--project-ref', projectRef]);
  await supabase(['db', 'push', '--password', process.env.SUPABASE_DB_PASSWORD]);
  await supabase(['functions', 'deploy', 'mining-api', '--project-ref', projectRef]);

  await supabase([
    'secrets',
    'set',
    `WORKER_API_SECRET=${workerApiSecret}`,
    `ADMIN_EMAILS=${adminEmails}`,
    '--project-ref',
    projectRef,
  ]);

  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(generatedEnvPath, JSON.stringify({
    API_URL: apiUrl,
    WORKER_API_SECRET: workerApiSecret,
  }, null, 2));

  console.log('[supabase-setup] Supabase migrations, function and secrets are ready.');
  console.log('[supabase-setup] Worker secret generated and stored in .runtime/generated-env.json.');
}

main().catch((error) => {
  console.error(`[supabase-setup] ${error.message}`);
  process.exit(1);
});
