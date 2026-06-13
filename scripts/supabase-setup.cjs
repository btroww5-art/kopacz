const { spawn } = require('child_process');

const required = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_PASSWORD',
  'WORKER_API_SECRET',
];

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

  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const adminEmails = process.env.ADMIN_EMAILS || '';

  await supabase(['link', '--project-ref', projectRef]);
  await supabase(['db', 'push', '--password', process.env.SUPABASE_DB_PASSWORD]);
  await supabase(['functions', 'deploy', 'mining-api', '--project-ref', projectRef]);

  await supabase([
    'secrets',
    'set',
    `WORKER_API_SECRET=${process.env.WORKER_API_SECRET}`,
    `ADMIN_EMAILS=${adminEmails}`,
    '--project-ref',
    projectRef,
  ]);

  console.log('[supabase-setup] Supabase migrations, function and secrets are ready.');
}

main().catch((error) => {
  console.error(`[supabase-setup] ${error.message}`);
  process.exit(1);
});
