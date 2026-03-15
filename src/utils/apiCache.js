/**
 * API Key Cache Manager
 * Stores API keys encrypted at rest and in memory for fast access.
 * On startup, keys are loaded from the encrypted keystore.
 * On mutation, the keystore is flushed to disk automatically.
 */

// In-memory cache: { universeId: apiKey }
const apiKeyCache = {};

// In-memory universe name cache: { universeId: universeName }
const universeNameCache = {};
const { MessageFlags } = require("discord.js");
const keystore = require("./keystore");

// Reference to the LLM key for co-persistence (set during loadFromDisk)
let _llmKeyRef = null;
let _llmKeyGetter = null;

/**
 * Serialize both caches + LLM key and write to encrypted keystore.
 * @returns {boolean} true if saved successfully (or persistence disabled), false on disk write failure
 */
function persistToDisk() {
  const data = {
    apiKeys: { ...apiKeyCache },
    universeNames: { ...universeNameCache },
  };
  if (_llmKeyGetter) {
    const llmKey = _llmKeyGetter();
    if (llmKey) data.llmKey = llmKey;
  }
  return keystore.saveKeystore(data);
}

/**
 * Load keys and universe names from encrypted keystore into memory.
 * Call once at startup, before the bot accepts commands.
 * @param {Function} [llmKeyGetter] - Optional function that returns the current LLM key (for co-persistence)
 * @returns {{ llmKey: string|null }} - Stored LLM key if present
 */
function loadFromDisk(llmKeyGetter) {
  _llmKeyGetter = llmKeyGetter || null;

  const data = keystore.loadKeystore();

  if (data.apiKeys) {
    Object.assign(apiKeyCache, data.apiKeys);
  }
  if (data.universeNames) {
    Object.assign(universeNameCache, data.universeNames);
  }

  return { llmKey: data.llmKey || null };
}

/**
 * Get API key for a universe
 * If not in cache, returns null
 * @param {number} universeId - The Roblox universe ID
 * @returns {string|null} - The API key or null if not cached
 */
function getApiKey(universeId) {
  return apiKeyCache[universeId] || null;
}

/**
 * Set API key for a universe in the cache and persist to disk
 * @param {number} universeId - The Roblox universe ID
 * @param {string} apiKey - The Roblox Open Cloud API key
 * @returns {boolean} true if persisted to disk successfully
 */
function setApiKey(universeId, apiKey) {
  apiKeyCache[universeId] = apiKey;
  return persistToDisk();
}

/**
 * Check if API key exists in cache for a universe
 * @param {number} universeId - The Roblox universe ID
 * @returns {boolean} - True if API key is cached
 */
function hasApiKey(universeId) {
  return apiKeyCache.hasOwnProperty(universeId);
}

/**
 * Get or prompt for API key
 * If API key is missing from cache, sends an ephemeral message prompting the user
 * @param {Object} interaction - Discord interaction object
 * @param {number} universeId - The Roblox universe ID
 * @returns {Promise<string|null>} - The API key if available/cached, null if user hasn't provided it
 */
async function getOrPromptApiKey(interaction, universeId) {
  // Check if we have it cached
  if (hasApiKey(universeId)) {
    return getApiKey(universeId);
  }

  // Prompt user with ephemeral message
  const promptMessage = await interaction.followUp({
    content: `🔑 **API Key Missing for Universe ${universeId}**\n\nPlease use the \`/setapikey\` command to store the API key for this universe.\n\`\`\`\n/setapikey <universeId> <apiKey>\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  });

  // Return null since the user hasn't provided it yet
  return null;
}

/**
 * Clear API key from cache and persist
 * @param {number} universeId - The Roblox universe ID
 */
function clearApiKey(universeId) {
  delete apiKeyCache[universeId];
  persistToDisk();
}

/**
 * Clear all cached API keys and persist
 */
function clearAllApiKeys() {
  Object.keys(apiKeyCache).forEach(key => delete apiKeyCache[key]);
  persistToDisk();
}

/**
 * Get list of cached universe IDs
 * @returns {number[]} - Array of universe IDs that have cached API keys
 */
function getCachedUniverseIds() {
  return Object.keys(apiKeyCache).map(Number);
}

/**
 * Create a Discord Embed for missing API key
 * @param {number} universeId - The Roblox universe ID
 * @returns {Object} - Discord embed object (EmbedBuilder compatible)
 */
function createMissingApiKeyEmbed(universeId) {
  const { EmbedBuilder } = require("discord.js");

  const isPersistent = keystore.isEnabled();

  return new EmbedBuilder()
    .setTitle("API Key Required")
    .setColor(0xFF9900)
    .setDescription(
      `No credential is configured for Universe \`${universeId}\`.\n\n` +
      `Use \`/setapikey\` to configure the API key for this universe.`
    )
    .addFields(
      {
        name: "Security",
        value:
          "• Never share your API key with unauthorized users\n" +
          (isPersistent
            ? "• Credentials are encrypted at rest"
            : "• Credentials are stored in memory only and will not persist across restarts"),
        inline: false,
      }
    )
    .setTimestamp();
}

/**
 * Cache the display name for a universe (called when /setapikey succeeds)
 * @param {number} universeId
 * @param {string} name
 */
function setUniverseName(universeId, name) {
  if (name) {
    universeNameCache[universeId] = name;
    persistToDisk();
  }
}

/**
 * Return all universes that have both an API key and a cached name.
 * Used to inject known game names into the NLP system prompt.
 * @returns {{ id: number, name: string }[]}
 */
function getCachedUniverses() {
  return Object.keys(apiKeyCache)
    .filter(id => universeNameCache[id])
    .map(id => ({ id: Number(id), name: universeNameCache[id] }));
}

module.exports = {
  getApiKey,
  setApiKey,
  hasApiKey,
  getOrPromptApiKey,
  clearApiKey,
  clearAllApiKeys,
  getCachedUniverseIds,
  createMissingApiKeyEmbed,
  setUniverseName,
  getCachedUniverses,
  loadFromDisk,
  persistToDisk,
};
