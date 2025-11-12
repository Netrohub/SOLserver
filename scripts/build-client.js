const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const clientPath = path.resolve(__dirname, '..', 'client');
const clientPackageJson = path.join(clientPath, 'package.json');

if (!fs.existsSync(clientPackageJson)) {
  console.warn(`⚠️ Client package.json not found at ${clientPackageJson}. Skipping client build.`);
  process.exit(0);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const result = spawnSync(npmCmd, ['run', 'build'], {
  cwd: clientPath,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error('Error running client build:', result.error);
  process.exit(result.status ?? 1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
