// NLP handler - orchestrator for /ask modal submissions: keyword filtering, consent,
// LLM processing, validation, then delegates to nlpConfirmation for UI and nlpExecutor for execution.

const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const llmCache = require("../utils/llmCache");
const log = require("../utils/logger");
const { RateLimiter } = require("../utils/rateLimiter");
const { pushHistory, getHistory, clearUserHistory, clearChannelHistories } = require("../utils/commandHistory");
const { processCommand } = require("./llmProcessor");
const { showConfirmationAndExecute } = require("./nlpConfirmation");
const { buildStatusEmbed, buildProcessingEmbed, buildConsentEmbed } = require("../utils/formatters");

// Per-user rate limiter for LLM calls: 5 requests per 60 seconds
const llmLimiter = new RateLimiter(5, 60_000);

// Keywords that must appear in the message for it to be forwarded to the LLM.
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

const MAX_INPUT_LENGTH = 1000;

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

/**
 * Inline consent flow for /ask modal interactions.
 * Shows consent embed via editReply, collects button response, returns true if accepted.
 */
async function showInteractionConsent(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("consent_accept").setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("consent_decline").setLabel("Decline").setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [buildConsentEmbed()], components: [row] });
  const reply = await interaction.fetchReply();
  const collector = reply.createMessageComponentCollector({ time: 120_000 });

  return new Promise((resolve) => {
    let settled = false;

    collector.on("collect", async (ci) => {
      if (!ci.member?.permissions.has("Administrator")) {
        await ci.reply({ content: "Only an administrator can accept data processing consent.", flags: MessageFlags.Ephemeral });
        return;
      }
      collector.stop("handled");

      if (ci.customId === "consent_accept") {
        apiCache.setConsent(interaction.guild.id, ci.user.id);
        await ci.update({
          embeds: [buildStatusEmbed("Consent Accepted", "NLP commands are now enabled for this server.\nPlease run `/ask` again to submit your command.", 0x00ff00)],
          components: [],
        });
        settled = true;
        resolve(true);
      } else {
        await ci.update({
          content: "Consent declined. NLP commands will not be available. Slash commands (e.g. `/ban`, `/showData`) still work normally.",
          embeds: [],
          components: [],
        });
        settled = true;
        resolve(false);
      }
    });

    collector.on("end", (_, reason) => {
      if (reason === "time") interaction.editReply({ components: [] }).catch(() => {});
      if (!settled) resolve(false);
    });
  });
}

// Main entry point - called from the ask_modal submission handler in index.js
async function handleNlpInteraction(interaction) {
  const textRaw = (interaction.options?.getString("prompt") || "").trim().slice(0, MAX_INPUT_LENGTH);
  const textLower = textRaw.toLowerCase();

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const editError = (title, description, color = 0xff0000) =>
    interaction.editReply({ embeds: [buildStatusEmbed(title, description, color)] });

  // Consent check
  if (interaction.guild && !apiCache.hasConsent(interaction.guild.id)) {
    const accepted = await showInteractionConsent(interaction);
    if (!accepted) return;
    // Consent just accepted - user must re-invoke /ask so the command is processed fresh
    return;
  }

  // LLM key check
  if (!llmCache.hasLlmKey(interaction.guildId)) {
    await editError("Setup Required", "No LLM API key configured.\nAn administrator must run `/setllmkey` first.");
    return;
  }

  // Keyword pre-filter
  const looksLikeCommand = COMMAND_KEYWORDS.some(kw => textLower.includes(kw));
  if (!looksLikeCommand) {
    await editError("Unrecognised Command", "I couldn't identify a command keyword in your message.\nTry including words like: **ban, show, data, leaderboard, list**, etc.", 0xffa500);
    return;
  }

  // Per-user rate limit on LLM calls to prevent cost abuse
  const llmCheck = llmLimiter.check(`llm:${interaction.user.id}`);
  if (!llmCheck.allowed) {
    const secs = Math.ceil(llmCheck.retryAfter / 1000);
    await editError("Slow Down", `You're sending commands too quickly. Try again in ${secs}s.`, 0xffa500);
    return;
  }

  if (!textRaw) {
    await editError("How can I help?", "Try something like:\n`ban user 12345 for cheating in MyGame`", 0x5865f2);
    return;
  }

  // Show processing indicator
  await interaction.editReply({ embeds: [buildProcessingEmbed("Analyzing your request. This may take a moment.")] });

  let commands;
  try {
    const knownUniverses = apiCache.getCachedUniverses(interaction.guildId);
    const history = getHistory(interaction.channelId, interaction.user.id);
    commands = await processCommand(textRaw, knownUniverses, history, interaction.guildId);
  } catch (err) {
    log.error("Unexpected error calling processCommand:", err.message);
    await editError("Processing Error", "Failed to process your request. Please try again.");
    return;
  }

  if (!commands[0]?.action) {
    await editError("Unrecognised Command", commands[0]?.confirmation_summary || "I couldn't understand that as a command.", 0xffa500);
    return;
  }

  const invalidAction = commands.find(cmd => !ALLOWED_ACTIONS.has(cmd.action));
  if (invalidAction) {
    log.warn(`Rejected unknown action "${invalidAction.action}" - possible prompt injection`);
    await editError("Invalid Command", "The parsed command contains an unrecognised action and was rejected.", 0xff0000);
    return;
  }

  // Type-validate all LLM-parsed parameters to catch prompt injection
  const paramError = commands.map(validateParsedParams).find(Boolean);
  if (paramError) {
    log.warn(`Rejected command with invalid parameters: ${paramError}`);
    await editError("Invalid Parameters", `Parameter validation failed: **${paramError}**`, 0xff0000);
    return;
  }

  // Reject batch sizes over the cap
  if (commands.length > MAX_BATCH_SIZE) {
    await editError("Too Many Commands", `Batch requests are limited to **${MAX_BATCH_SIZE} commands** at a time. Your request parsed ${commands.length}.`, 0xff0000);
    return;
  }

  // Full-replacement writes (setData) must not be batched
  if (commands.length > 1 && commands.some(cmd => cmd.action === "setData")) {
    await editError("Cannot Batch Data Writes", "`setData` commands must be executed one at a time to avoid overwriting data.", 0xff0000);
    return;
  }

  // Reject any universeId not already configured via /setapikey
  const unconfiguredUniverse = commands.find(
    cmd => cmd.parameters.universeId && !apiCache.hasApiKey(interaction.guildId, cmd.parameters.universeId)
  );
  if (unconfiguredUniverse) {
    await editError("Unknown Universe", `Universe **${unconfiguredUniverse.parameters.universeId}** has no API key configured.\nOnly universes set up via \`/setapikey\` can be used.`, 0xff0000);
    return;
  }

  // Collect all missing params across commands
  const allMissing = [...new Set(commands.flatMap(cmd => cmd.missing))];
  if (allMissing.length > 0) {
    await editError("Missing Information", `I need more details to proceed:\n**${allMissing.join(", ")}**`, 0xffa500);
    return;
  }

  // Collect all referenced universe IDs
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
    interaction,
    pushHistoryFn: (chId, uId, action, params) => pushHistory(chId, uId, action, params, "nlp"),
    skipConfirmation: allReadOnly,
  });
}

module.exports = { handleNlpInteraction, pushHistory, clearUserHistory, clearChannelHistories };
