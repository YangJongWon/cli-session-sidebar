const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

const nodeCommon = {
  ...shared,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode', 'node-pty'],
};

async function main() {
  const options = [
    { ...nodeCommon, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
    { ...nodeCommon, entryPoints: ['src/daemon.ts'], outfile: 'dist/daemon.js' },
    { ...nodeCommon, entryPoints: ['src/selftest.ts'], outfile: 'dist/selftest.js' },
    { ...nodeCommon, entryPoints: ['src/controllerTest.ts'], outfile: 'dist/controllerTest.js' },
    { ...nodeCommon, entryPoints: ['src/smoke.ts'], outfile: 'dist/smoke.js' },
    {
      ...shared,
      entryPoints: ['src/webview/main.ts'],
      outfile: 'media/main.js',
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
    },
  ];

  if (watch) {
    const contexts = await Promise.all(options.map((option) => esbuild.context(option)));
    await Promise.all(contexts.map((context) => context.watch()));
    return;
  }

  await Promise.all(options.map((option) => esbuild.build(option)));
  const from = path.join('node_modules', '@xterm', 'xterm', 'css', 'xterm.css');
  fs.mkdirSync('media', { recursive: true });
  fs.copyFileSync(from, path.join('media', 'xterm.css'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
