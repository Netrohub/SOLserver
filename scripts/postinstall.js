/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: useShell,
    ...options,
  });

  if (result.error) {
    console.error(`Error running ${command}:`, result.error);
    process.exit(result.status ?? 1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const useShell = process.platform === 'win32';
const npxCmd = 'npx';
const npmCmd = 'npm';

const prismaGeneratedPath = path.resolve(__dirname, '..', 'node_modules', '.prisma');
try {
  fs.rmSync(prismaGeneratedPath, { recursive: true, force: true });
} catch (error) {
  if (error && error.code !== 'ENOENT') {
    console.warn('Warning while cleaning Prisma artifacts:', error);
  }
}

run(npxCmd, ['prisma', 'generate']);

const clientPath = path.resolve(__dirname, '..', 'client');
const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.RAILWAY_ENVIRONMENT?.toLowerCase() === 'production' ||
  process.env.npm_config_production === 'true';

const installArgs = ['install', '--prefix', clientPath];

if (isProduction) {
  installArgs.push('--omit=dev');
}

const clientPackageJson = path.join(clientPath, 'package.json');

if (!fs.existsSync(clientPackageJson)) {
  console.warn(`⚠️ Client package.json not found at ${clientPackageJson}. Skipping client dependency install.`);
  process.exit(0);
}

run(npmCmd, installArgs);

