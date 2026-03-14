/**
 * LLM API Key Cache
 * Stores the Anthropic API key in memory for the current session.
 * Lost on bot restart — re-set with /setllmkey.
 */

let _key = null;

module.exports = {
  getLlmKey: () => _key || process.env.ANTHROPIC_API_KEY || null,
  setLlmKey: (key) => { _key = key; },
  hasLlmKey: () => _key !== null || !!process.env.ANTHROPIC_API_KEY,
};
