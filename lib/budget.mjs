// Spend guard for paid calls (AI patient = one LLM completion per message). Playwright runs
// one worker, so a module-level counter is the whole run's spend.
import { flags } from './env.mjs';

let aiCalls = 0;

/** Call before every paid AI request; throws once QA_AI_MAX_CALLS is reached. */
export function spendAiCall(what = 'AI call') {
  if (aiCalls >= flags.aiMaxCalls) {
    throw new Error(`AI budget exhausted (${flags.aiMaxCalls} calls, QA_AI_MAX_CALLS). Refusing ${what}.`);
  }
  aiCalls += 1;
  return aiCalls;
}

export const aiCallsUsed = () => aiCalls;
