/**
 * LLM API Key Cache
 * Stores the Anthropic API key in memory for the current session.
 * Lost on bot restart — re-set with /setllmkey.
 */

let _key = null;

module.exports = {
  getLlmKey: () => _key,
  setLlmKey: (key) => { _key = key; },
  hasLlmKey: () => _key !== null,
};
