/**
 * LLM API Key Cache
 * Stores the Anthropic API key in memory and persists it
 * via the encrypted keystore alongside Roblox API keys.
 */

let _key = null;
let _skipPersist = false;

const getLlmKey = () => _key || process.env.ANTHROPIC_API_KEY || null;

/**
 * @returns {boolean} true if persisted to disk successfully
 */
const setLlmKey = (key) => {
  _key = key;
  if (!_skipPersist) {
    try {
      const apiCache = require("./apiCache");
      return apiCache.persistToDisk();
    } catch {
      // apiCache may not be loaded yet during startup hydration
      return true;
    }
  }
  return true;
};

/**
 * Set the LLM key without triggering a disk persist.
 * Used during startup hydration to avoid a redundant write.
 */
const hydrateLlmKey = (key) => {
  _skipPersist = true;
  _key = key;
  _skipPersist = false;
};

const hasLlmKey = () => _key !== null || !!process.env.ANTHROPIC_API_KEY;

module.exports = {
  getLlmKey,
  setLlmKey,
  hydrateLlmKey,
  hasLlmKey,
};
