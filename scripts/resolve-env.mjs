#!/usr/bin/env node
// Usage: npm run env:resolve -- https://test.clinicaone.app
// Prints the env key, web/API/socket URLs and deploy branch for a link (or QA_TARGET).
import { resolveEnv } from '../lib/env.mjs';

const target = process.argv[2] || process.env.QA_TARGET || 'dev';
try {
  const e = resolveEnv(target);
  console.log(JSON.stringify({ target, ...e, socket: `${e.socketUrl} (path ${e.socketPath})` }, null, 2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
