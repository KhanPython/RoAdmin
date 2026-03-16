// API key cache - stores keys in memory, auto-flushes to encrypted keystore on mutation

// In-memory caches
const apiKeyCache = {};
const universeNameCache = {};
const consentCache = {};
// Icon URL cache with TTL (not persisted - CDN URLs can expire)
const universeIconCache = {};
const ICON_TTL_MS = 60 * 60 * 1000; // 1 hour

// Composite key for guild-scoped API key storage (prevents cross-server key leakage)
function _guildKey(guildId, universeId) {
  return `${guildId}:${universeId}`;
}

const { MessageFlags } = require("discord.js");
const keystore = require("./keystore");
const log = require("./logger");

// Safe key-by-key merge that blocks __proto__ / constructor / prototype pollution
function safeAssign(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    if (source !== undefined && source !== null) {
      log.warn("safeAssign: skipping non-object source", typeof source);
    }
    return;
  }
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    target[key] = source[key];
  }
}

let _llmKeysGetter = null;

// Serialize caches + per-guild LLM keys and write to encrypted keystore
function persistToDisk() {
  const data = {
    apiKeys: { ...apiKeyCache },
    universeNames: { ...universeNameCache },
  };
  if (_llmKeysGetter) {
    const llmKeys = _llmKeysGetter();
    if (llmKeys && Object.keys(llmKeys).length > 0) data.llmKeys = llmKeys;
  }
  if (Object.keys(consentCache).length > 0) {
    data.consent = { ...consentCache };
  }
  return keystore.saveKeystore(data);
}

// Load keys and universe names from encrypted keystore into memory (call once at startup)
function loadFromDisk(llmKeysGetter) {
  _llmKeysGetter = llmKeysGetter || null;

  const data = keystore.loadKeystore();

  if (data.apiKeys) {
    // Only load guild-scoped keys (format "guildId:universeId"); skip legacy un-scoped keys
    const scoped = {};
    for (const [k, v] of Object.entries(data.apiKeys)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (k.includes(":")) {
        scoped[k] = v;
      } else {
        log.warn(`Skipping legacy un-scoped API key for universe ${k} — re-enter via /setapikey`);
      }
    }
    safeAssign(apiKeyCache, scoped);
  }
  if (data.universeNames) {
    safeAssign(universeNameCache, data.universeNames);
  }
  if (data.consent) {
    safeAssign(consentCache, data.consent);
  }

  return { llmKeys: data.llmKeys || {} };
}

function getApiKey(guildId, universeId) {
  return apiKeyCache[_guildKey(guildId, universeId)] || null;
}

function setApiKey(guildId, universeId, apiKey) {
  apiKeyCache[_guildKey(guildId, universeId)] = apiKey;
  return persistToDisk();
}

function hasApiKey(guildId, universeId) {
  return Object.prototype.hasOwnProperty.call(apiKeyCache, _guildKey(guildId, universeId));
}

// Return cached key, or prompt the user to run /setapikey and return null
async function getOrPromptApiKey(interaction, universeId) {
  const guildId = interaction.guildId;
  if (hasApiKey(guildId, universeId)) {
    return getApiKey(guildId, universeId);
  }

  await interaction.followUp({
    content: `🔑 **API Key Missing for Universe ${universeId}**\n\nPlease use the \`/setapikey\` command to store the API key for this universe.\n\`\`\`\n/setapikey <universeId> <apiKey>\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  });

  return null;
}

function clearApiKey(guildId, universeId) {
  delete apiKeyCache[_guildKey(guildId, universeId)];
  persistToDisk();
}

function clearGuildApiKeys(guildId) {
  const prefix = `${guildId}:`;
  for (const key of Object.keys(apiKeyCache)) {
    if (key.startsWith(prefix)) delete apiKeyCache[key];
  }
  persistToDisk();
}

function clearAllApiKeys() {
  Object.keys(apiKeyCache).forEach(key => delete apiKeyCache[key]);
  persistToDisk();
}

function getCachedUniverseIds(guildId) {
  const prefix = `${guildId}:`;
  return Object.keys(apiKeyCache)
    .filter(k => k.startsWith(prefix))
    .map(k => Number(k.split(":")[1]));
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

function getUniverseIcon(universeId) {
  const entry = universeIconCache[universeId];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete universeIconCache[universeId];
    return null;
  }
  return entry.url;
}

function setUniverseIcon(universeId, url, ttlMs = ICON_TTL_MS) {
  universeIconCache[universeId] = {
    url,
    expiresAt: Date.now() + ttlMs,
  };
}

function getCachedUniverses(guildId) {
  const prefix = `${guildId}:`;
  return Object.keys(apiKeyCache)
    .filter(k => k.startsWith(prefix) && universeNameCache[k.split(":")[1]])
    .map(k => {
      const uid = k.split(":")[1];
      return { id: Number(uid), name: universeNameCache[uid] };
    });
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
  clearGuildApiKeys,
  clearAllApiKeys,
  getCachedUniverseIds,
  createMissingApiKeyEmbed,
  setUniverseName,
  getUniverseIcon,
  setUniverseIcon,
  getCachedUniverses,
  loadFromDisk,
  persistToDisk,
  setConsent,
  hasConsent,
  revokeConsent,
};
