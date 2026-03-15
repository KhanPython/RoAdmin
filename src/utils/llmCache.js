// LLM API key cache — stores Anthropic key in memory, co-persisted in encrypted keystore

let _key = null;
let _skipPersist = false;

const getLlmKey = () => _key || process.env.ANTHROPIC_API_KEY || null;

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

// Set key without persisting (used during startup hydration)
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
