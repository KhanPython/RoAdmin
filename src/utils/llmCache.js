// LLM API key cache - stores Anthropic keys per-guild in memory, co-persisted in encrypted keystore

const _keys = new Map(); // guildId → key
let _skipPersist = false;

const getLlmKey = (guildId) => _keys.get(guildId) ?? null;

const setLlmKey = (guildId, key) => {
  if (key === null || key === undefined) {
    _keys.delete(guildId);
  } else {
    _keys.set(guildId, key);
  }
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
const hydrateLlmKey = (guildId, key) => {
  _skipPersist = true;
  if (key) _keys.set(guildId, key);
  _skipPersist = false;
};

const hasLlmKey = (guildId) => _keys.has(guildId) && _keys.get(guildId) !== null;

const clearGuildLlmKey = (guildId) => setLlmKey(guildId, null);

// Returns a plain object snapshot of all guild → key pairs (used by apiCache for persistence)
const getAllLlmKeys = () => Object.fromEntries(_keys);

module.exports = {
  getLlmKey,
  setLlmKey,
  hydrateLlmKey,
  hasLlmKey,
  clearGuildLlmKey,
  getAllLlmKeys,
};
