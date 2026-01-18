/**
 * API Key Cache Manager
 * Stores API keys in memory for specific universes
 * Prompts user to enter API key if missing for a universe
 */

// In-memory cache: { universeId: apiKey }
const apiKeyCache = {};
const { MessageFlags } = require("discord.js");

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
 * Set API key for a universe in the cache
 * @param {number} universeId - The Roblox universe ID
 * @param {string} apiKey - The Roblox Open Cloud API key
 */
function setApiKey(universeId, apiKey) {
  apiKeyCache[universeId] = apiKey;
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
    content: `🔑 **API Key Missing for Universe ${universeId}**\n\nPlease use the \`/setapikey\` command to store the API key for this universe.\n\`\`\`\n/setapikey <universeId> <apiKey>\n\`\`\`\n\nThe API key will be cached for this session only.`,
    flags: MessageFlags.Ephemeral,
  });

  // Return null since the user hasn't provided it yet
  return null;
}

/**
 * Clear API key from cache
 * @param {number} universeId - The Roblox universe ID
 */
function clearApiKey(universeId) {
  delete apiKeyCache[universeId];
}

/**
 * Clear all cached API keys
 */
function clearAllApiKeys() {
  Object.keys(apiKeyCache).forEach(key => delete apiKeyCache[key]);
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
  
  return new EmbedBuilder()
    .setTitle("🔑 API Key Missing")
    .setColor(0xFF9900)
    .setDescription(
      `No API key is currently cached for Universe **${universeId}**.\n\n` +
      `Please use the \`/setapikey\` command to store the API key for this universe.`
    )
    .addFields(
      {
        name: "Important Security Notice",
        value:
          "• Never share your API key with others\n" +
          "• The API key is stored in bot memory only\n" +
          "• Keys will be lost when the bot restarts\n",
        inline: false,
      },
      {
        name: "Session Information",
        value: "This API key will be cached for the current session only.",
        inline: false,
      }
    )
    .setTimestamp();
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
};
