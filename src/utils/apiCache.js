// API key cache — stores keys in memory, auto-flushes to encrypted keystore on mutation

// In-memory caches
const apiKeyCache = {};
const universeNameCache = {};
const consentCache = {};

const { MessageFlags } = require("discord.js");
const keystore = require("./keystore");

let _llmKeyRef = null;
let _llmKeyGetter = null;

// Serialize caches + LLM key and write to encrypted keystore
function persistToDisk() {
  const data = {
    apiKeys: { ...apiKeyCache },
    universeNames: { ...universeNameCache },
  };
  if (_llmKeyGetter) {
    const llmKey = _llmKeyGetter();
    if (llmKey) data.llmKey = llmKey;
  }
  if (Object.keys(consentCache).length > 0) {
    data.consent = { ...consentCache };
  }
  return keystore.saveKeystore(data);
}

// Load keys and universe names from encrypted keystore into memory (call once at startup)
function loadFromDisk(llmKeyGetter) {
  _llmKeyGetter = llmKeyGetter || null;

  const data = keystore.loadKeystore();

  if (data.apiKeys) {
    Object.assign(apiKeyCache, data.apiKeys);
  }
  if (data.universeNames) {
    Object.assign(universeNameCache, data.universeNames);
  }
  if (data.consent) {
    Object.assign(consentCache, data.consent);
  }

  return { llmKey: data.llmKey || null };
}

function getApiKey(universeId) {
  return apiKeyCache[universeId] || null;
}

function setApiKey(universeId, apiKey) {
  apiKeyCache[universeId] = apiKey;
  return persistToDisk();
}

function hasApiKey(universeId) {
  return apiKeyCache.hasOwnProperty(universeId);
}

// Return cached key, or prompt the user to run /setapikey and return null
async function getOrPromptApiKey(interaction, universeId) {
  if (hasApiKey(universeId)) {
    return getApiKey(universeId);
  }

  await interaction.followUp({
    content: `🔑 **API Key Missing for Universe ${universeId}**\n\nPlease use the \`/setapikey\` command to store the API key for this universe.\n\`\`\`\n/setapikey <universeId> <apiKey>\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  });

  return null;
}

function clearApiKey(universeId) {
  delete apiKeyCache[universeId];
  persistToDisk();
}

function clearAllApiKeys() {
  Object.keys(apiKeyCache).forEach(key => delete apiKeyCache[key]);
  persistToDisk();
}

function getCachedUniverseIds() {
  return Object.keys(apiKeyCache).map(Number);
}

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

function setUniverseName(universeId, name) {
  if (name) {
    universeNameCache[universeId] = name;
    persistToDisk();
  }
}

function getCachedUniverses() {
  return Object.keys(apiKeyCache)
    .filter(id => universeNameCache[id])
    .map(id => ({ id: Number(id), name: universeNameCache[id] }));
}

function setConsent(guildId, userId) {
  consentCache[guildId] = {
    accepted: true,
    acceptedBy: userId,
    acceptedAt: new Date().toISOString(),
  };
  persistToDisk();
}

function hasConsent(guildId) {
  return consentCache[guildId]?.accepted === true;
}

function revokeConsent(guildId) {
  delete consentCache[guildId];
  persistToDisk();
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
  setConsent,
  hasConsent,
  revokeConsent,
};
