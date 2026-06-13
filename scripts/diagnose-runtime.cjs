const { existsSync, readFileSync } = require('fs');
const { spawnSync } = require('child_process');
const { join, resolve } = require('path');

const rootDir = resolve(__dirname, '..');
const xmrigPath = join(rootDir, '.runtime', 'xmrig');
const archivePath = join(rootDir, 'public', 'xmrig-6.22.0-linux-static-x64.tar.gz');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    status: result.status,
    error: result.error ? result.error.message : '',
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function printResult(label, result) {
  console.log(`\n[diagnose] ${label}`);
  console.log(`status: ${result.status}`);
  if (result.error) console.log(`error: ${result.error}`);
  if (result.stdout) console.log(`stdout:\n${result.stdout}`);
  if (result.stderr) console.log(`stderr:\n${result.stderr}`);
}

console.log('[diagnose] Runtime');
console.log(`platform: ${process.platform}`);
console.log(`arch: ${process.arch}`);
console.log(`node: ${process.version}`);
console.log(`cwd: ${rootDir}`);

printResult('uname -a', run('uname', ['-a']));
printResult('which sh', run('which', ['sh']));
printResult('which tar', run('which', ['tar']));

console.log(`\n[diagnose] archive exists: ${existsSync(archivePath)} ${archivePath}`);
console.log(`[diagnose] xmrig exists: ${existsSync(xmrigPath)} ${xmrigPath}`);

if (existsSync(xmrigPath)) {
  const bytes = readFileSync(xmrigPath);
  const magic = [...bytes.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  const ascii = bytes.subarray(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
  console.log(`[diagnose] xmrig size: ${bytes.length}`);
  console.log(`[diagnose] xmrig first 16 bytes hex: ${magic}`);
  console.log(`[diagnose] xmrig first 16 bytes ascii: ${ascii}`);
  console.log(`[diagnose] expected ELF starts with: 7f 45 4c 46`);

  printResult('xmrig --version direct exec', run(xmrigPath, ['--version']));
  printResult('sh -c xmrig --version', run('sh', ['-c', `${xmrigPath} --version`]));
}
