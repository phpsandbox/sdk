import * as esbuild from 'esbuild';

// Build browser bundle (ESM)
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/browser/phpsandbox-sdk.esm.js',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  minify: false,
});

// Build browser bundle (ESM minified)
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/browser/phpsandbox-sdk.esm.min.js',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  minify: true,
});

// Build browser bundle (IIFE for direct script tags)
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'PHPSandbox',
  outfile: 'dist/browser/phpsandbox-sdk.iife.js',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  minify: false,
});

// Build browser bundle (IIFE minified)
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'PHPSandbox',
  outfile: 'dist/browser/phpsandbox-sdk.iife.min.js',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  minify: true,
});

console.log('✓ Browser bundles created successfully');
