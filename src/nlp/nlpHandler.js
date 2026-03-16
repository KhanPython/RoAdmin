// NLP handler - thin orchestrator: mention detection, keyword filtering, consent,
// LLM processing, validation, then delegates to nlpConfirmation for UI and nlpExecutor for execution.

const { EmbedBuilder } = require("discord.js");

const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const log = require("../utils/logger");
const { RateLimiter } = require("../utils/rateLimiter");
const { processCommand } = require("./llmProcessor");
const { buildProcessingEmbed } = require("../utils/formatters");
const { validateNlpPrerequisites } = require("../utils/commandValidator");
const { showConfirmationAndExecute } = require("./nlpConfirmation");
const { version } = require("../../package.json");

// Per-user rate limiter for LLM calls: 5 requests per 60 seconds
const llmLimiter = new RateLimiter(5, 60_000);

// Keywords that must appear in the message for it to be forwarded to the LLM.
// Anything that doesn't match is silently ignored (no API call, no reply).
const COMMAND_KEYWORDS = [
  "ban", "unban", "remove", "kick",
  "show", "data", "datastore",
  "leaderboard", "list",
  "universe", "user", "player", "entry",
  "check", "status", "banned", "bans",
  "set", "keys", "update", "change", "modify",
  // Context-aware keywords (allow follow-up commands)
  "previous", "last", "same", "again", "undo",
];

const MAX_HISTORY = 20;
const MAX_HISTORY_KEYS = 10_000;
const commandHistory = new Map(); // `${channelId}:${userId}` → [{ action, parameters, timestamp }]

function pushHistory(channelId, userId, action, parameters) {
  const key = `${channelId}:${userId}`;
  if (!commandHistory.has(key) && commandHistory.size >= MAX_HISTORY_KEYS) return;
  if (!commandHistory.has(key)) commandHistory.set(key, []);
  const history = commandHistory.get(key);
  history.push({ action, parameters, timestamp: new Date().toISOString() });
  if (history.length > MAX_HISTORY) history.shift();
}

function getHistory(channelId, userId) {
  return commandHistory.get(`${channelId}:${userId}`) || [];
}

function clearUserHistory(userId) {
  let count = 0;
  const suffix = `:${userId}`;
  for (const [key, entries] of commandHistory) {
    if (key.endsWith(suffix)) {
      count += entries.length;
      commandHistory.delete(key);
    }
  }
  return count;
}

function clearChannelHistories(channelIds) {
  let count = 0;
  const channelSet = new Set(channelIds.map(String));
  for (const [key, entries] of commandHistory) {
    const channelId = key.split(":")[0];
    if (channelSet.has(channelId)) {
      count += entries.length;
      commandHistory.delete(key);
    }
  }
  return count;
}

const universeInfoMap = new Map();
const MAX_UNIVERSE_INFO_CACHE = 500;

const ALLOWED_ACTIONS = new Set(["ban", "unban", "showData", "listLeaderboard", "removeFromBoard", "checkBan", "listBans", "setData", "updateData", "listKeys"]);
const MAX_BATCH_SIZE = 10;

// Type-validate LLM-parsed parameters to mitigate prompt injection
function validateParsedParams(cmd) {
  const p = cmd.parameters;
  if (p.userId !== undefined) {
    p.userId = Number(p.userId);
    if (!Number.isFinite(p.userId) || p.userId <= 0 || !Number.isInteger(p.userId)) return "userId must be a positive integer";
  }
  if (p.universeId !== undefined) {
    p.universeId = Number(p.universeId);
    if (!Number.isFinite(p.universeId) || p.universeId <= 0 || !Number.isInteger(p.universeId)) return "universeId must be a positive integer";
  }
  if (p.key !== undefined && typeof p.key !== "string") p.key = String(p.key);
  if (p.datastoreName !== undefined && typeof p.datastoreName !== "string") p.datastoreName = String(p.datastoreName);
  if (p.leaderboardName !== undefined && typeof p.leaderboardName !== "string") p.leaderboardName = String(p.leaderboardName);
  if (p.reason !== undefined && typeof p.reason !== "string") p.reason = String(p.reason);
  if (p.value !== undefined && typeof p.value !== "string") p.value = String(p.value);
  if (p.scope !== undefined && typeof p.scope !== "string") p.scope = String(p.scope);
  if (p.scope !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(p.scope)) return "scope contains invalid characters";
  // Length caps to prevent abuse
  for (const strKey of ["key", "datastoreName", "leaderboardName", "reason", "value", "scope", "duration", "field", "newValue"]) {
    if (typeof p[strKey] === "string" && p[strKey].length > 1000) return `${strKey} exceeds maximum length`;
  }
  return null;
}

// Merge consecutive updateData commands targeting the same entry into one operation
function mergeConsecutiveUpdateData(commands) {
  const merged = [];
  for (const cmd of commands) {
    const last = merged[merged.length - 1];
    if (
      cmd.action === "updateData" &&
      last?.action === "updateData" &&
      last.parameters.key === cmd.parameters.key &&
      last.parameters.universeId === cmd.parameters.universeId &&
      last.parameters.datastoreName === cmd.parameters.datastoreName &&
      (last.parameters.scope || "global") === (cmd.parameters.scope || "global")
    ) {
      last.parameters.fields.push({ field: cmd.parameters.field, newValue: cmd.parameters.newValue });
      last.confirmation_summary += `; set ${cmd.parameters.field} to ${cmd.parameters.newValue}`;
    } else if (cmd.action === "updateData") {
      merged.push({
        ...cmd,
        parameters: {
          ...cmd.parameters,
          fields: [{ field: cmd.parameters.field, newValue: cmd.parameters.newValue }],
        },
      });
    } else {
      merged.push(cmd);
    }
  }
  return merged;
}

function buildEmbed(title, description, color = 0xff0000) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

async function replyEmbed(message, title, description, color) {
  return message.reply({ embeds: [buildEmbed(title, description, color)] });
}

// Main entry point - call from client.on('messageCreate', ...)
async function handleMessage(client, message) {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const MAX_INPUT_LENGTH = 1000;
  const textRaw = message.content.replace(/<@!?\d+>/g, "").trim().slice(0, MAX_INPUT_LENGTH);
  const textLower = textRaw.toLowerCase();

  // About intent - handle before consent/keyword checks (no LLM required, but admin required)
  const ABOUT_PHRASES = ["about yourself", "about you", "who are you", "what are you", "introduce yourself", "tell me about"];
  if (ABOUT_PHRASES.some(p => textLower.includes(p))) {
    if (!message.member?.permissions.has("Administrator")) {
      await replyEmbed(message, "Permission Denied", "You need **Administrator** permission to use this command.");
      return;
    }
    const app = await client.application.fetch();
    const uptime = (() => {
      const ms = client.uptime;
      if (!ms) return "Unknown";
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const parts = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0) parts.push(`${h}h`);
      parts.push(`${m}m`);
      return parts.join(" ");
    })();
    const keystore = require("../utils/keystore");
    const consentStatus = message.guild && apiCache.hasConsent(message.guild.id);
    const storageMode = keystore.isEnabled() ? "Encrypted at rest" : "Memory-only (session)";
    const embed = new EmbedBuilder()
      .setTitle(app.name || "RoAdmin")
      .setDescription(app.description || "A Discord bot for managing Roblox experiences via Open Cloud API.")
      .setColor(0x5865f2)
      .addFields(
        { name: "Version", value: version, inline: true },
        { name: "Uptime", value: uptime, inline: true },
        { name: "Guilds", value: String(client.guilds.cache.size), inline: true },
        { name: "Credential Storage", value: storageMode, inline: true },
        { name: "NLP Consent", value: consentStatus ? "Accepted" : "Not accepted", inline: true },
        {
          name: "Data Practices",
          value:
            "\u2022 API keys are encrypted with AES-256-GCM when `ENCRYPTION_KEY` is set\n" +
            "\u2022 NLP commands send your message text to Anthropic (Claude) for parsing\n" +
            "\u2022 Your Discord user ID is attached to ban actions as an audit trail on Roblox\n" +
            "\u2022 Command history is held in memory only and cleared on restart\n" +
            "\u2022 Use `/forgetme` to delete all stored data at any time",
        }
      )
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return;
  }

  // Keyword pre-filter - silently ignore non-command messages
  const looksLikeCommand = COMMAND_KEYWORDS.some(kw => textLower.includes(kw));
  if (!looksLikeCommand) return;

  const prereq = await validateNlpPrerequisites(message);
  if (!prereq.valid) return;

  // Per-user rate limit on LLM calls to prevent cost abuse
  const llmCheck = llmLimiter.check(`llm:${message.author.id}`);
  if (!llmCheck.allowed) {
    const secs = Math.ceil(llmCheck.retryAfter / 1000);
    await replyEmbed(message, "Slow Down", `You're sending commands too quickly. Try again in ${secs}s.`, 0xffa500);
    return;
  }

  if (!textRaw) {
    await replyEmbed(message, "How can I help?", "Try something like:\n`ban user 12345 for cheating in MyGame`", 0x5865f2);
    return;
  }

  // Send thinking indicator immediately before the slow LLM call
  const thinkingReply = await message.reply({ embeds: [buildProcessingEmbed("Analyzing your request. This may take a moment.")] });

  const editThinkingError = async (title, description, color = 0xff0000) => {
    return thinkingReply.edit({ embeds: [buildEmbed(title, description, color)], components: [] });
  };

  let commands;
  try {
    const knownUniverses = apiCache.getCachedUniverses(message.guildId);
    const history = getHistory(message.channel.id, message.author.id);
    commands = await processCommand(textRaw, knownUniverses, history, message.guildId);
  } catch (err) {
    log.error("Unexpected error calling processCommand:", err.message);
    await editThinkingError("Processing Error", "Failed to process your request. Please try again.");
    return;
  }

  if (!commands[0]?.action) {
    await editThinkingError("Unrecognised Command", commands[0]?.confirmation_summary || "I couldn't understand that as a command.", 0xffa500);
    return;
  }

  const invalidAction = commands.find(cmd => !ALLOWED_ACTIONS.has(cmd.action));
  if (invalidAction) {
    log.warn(`Rejected unknown action "${invalidAction.action}" - possible prompt injection`);
    await editThinkingError("Invalid Command", "The parsed command contains an unrecognised action and was rejected.", 0xff0000);
    return;
  }

  // Type-validate all LLM-parsed parameters to catch prompt injection
  const paramError = commands.map(validateParsedParams).find(Boolean);
  if (paramError) {
    log.warn(`Rejected command with invalid parameters: ${paramError}`);
    await editThinkingError("Invalid Parameters", `Parameter validation failed: **${paramError}**`, 0xff0000);
    return;
  }

  // Reject batch sizes over the cap
  if (commands.length > MAX_BATCH_SIZE) {
    await editThinkingError("Too Many Commands", `Batch requests are limited to **${MAX_BATCH_SIZE} commands** at a time. Your request parsed ${commands.length}.`, 0xff0000);
    return;
  }

  // Full-replacement writes (setData) must not be batched - too easy to accidentally overwrite.
  // updateData (field-level patches) ARE allowed to batch: execution is sequential so each
  // write fetches the already-patched value from the previous step and chains correctly.
  if (commands.length > 1 && commands.some(cmd => cmd.action === "setData")) {
    await editThinkingError("Cannot Batch Data Writes", "`setData` commands must be executed one at a time to avoid overwriting data.", 0xff0000);
    return;
  }

  // Reject any universeId not already configured via /setapikey
  const unconfiguredUniverse = commands.find(
    cmd => cmd.parameters.universeId && !apiCache.hasApiKey(message.guildId, cmd.parameters.universeId)
  );
  if (unconfiguredUniverse) {
    await editThinkingError("Unknown Universe", `Universe **${unconfiguredUniverse.parameters.universeId}** has no API key configured.\nOnly universes set up via \`/setapikey\` can be used.`, 0xff0000);
    return;
  }

  // Collect all missing params across commands
  const allMissing = [...new Set(commands.flatMap(cmd => cmd.missing))];
  if (allMissing.length > 0) {
    await editThinkingError("Missing Information", `I need more details to proceed:\n**${allMissing.join(", ")}**`, 0xffa500);
    return;
  }

  // Collect all referenced universe IDs (already verified above)
  const universeIds = [...new Set(commands.map(cmd => cmd.parameters.universeId).filter(Boolean))];

  await Promise.all(universeIds.map(async (uid) => {
    try {
      if (universeInfoMap.size >= MAX_UNIVERSE_INFO_CACHE) universeInfoMap.clear();
      universeInfoMap.set(uid, await openCloud.GetUniverseName(uid));
    } catch (err) { log.debug("Universe info fetch failed:", err.message); }
  }));

  // Collapse consecutive updateData commands on the same entry into one operation
  commands = mergeConsecutiveUpdateData(commands);

  // Read-only actions carry no mutation risk - skip the confirmation dialog
  const READ_ONLY_ACTIONS = new Set(["showData", "listKeys", "listLeaderboard", "checkBan", "listBans"]);
  const allReadOnly = commands.every(cmd => READ_ONLY_ACTIONS.has(cmd.action));

  // Hand off to confirmation UI → executor pipeline
  await showConfirmationAndExecute({
    commands,
    universeInfoMap,
    message,
    thinkingReply,
    pushHistoryFn: pushHistory,
    skipConfirmation: allReadOnly,
  });
}

module.exports = { handleMessage, pushHistory, clearUserHistory, clearChannelHistories };
