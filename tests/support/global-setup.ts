import { resolveEnv, flags } from '../../lib/env.mjs';
import { getSession } from '../../lib/auth.mjs';

// Prints what we're about to test and warms the cached learner session (one login per run).
export default async function globalSetup() {
  const env = resolveEnv();
  console.log(`\n[qa] target=${env.key} web=${env.web} api=${env.api} writes=${env.writesAllowed ? 'allowed' : 'READ-ONLY'}`);

  for (const [label, url] of [['web', `${env.web}/version.json`], ['api', `${env.apiOrigin}/version`]]) {
    try {
      const v = await (await fetch(url)).json();
      console.log(`[qa] ${label} build ${v.version} ${v.commit} (${v.branch}) ${v.builtAt ?? v.startedAt ?? ''}`);
    } catch (e) {
      console.log(`[qa] ${label} version unavailable: ${(e as Error).message}`);
    }
  }

  if (flags.publicOnly) {
    console.log('[qa] mode=public: no login, only @public tests\n');
    return;
  }
  try {
    const s = await getSession('learner', env);
    console.log(`[qa] learner session ok: ${s.user?.email} role=${s.user?.role}\n`);
  } catch (e) {
    // Smoke checks that don't need auth should still run; authed tests will fail with this message.
    console.warn(`[qa] WARNING: ${(e as Error).message}\n`);
  }
}
