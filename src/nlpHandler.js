/**
 * Natural Language Processing Handler
 * Fires on messageCreate events. When the bot is @mentioned and the message
 * looks like a Roblox admin command, it calls Claude (Anthropic) to parse the
 * intent and presents a confirmation before executing.
 *
 * Visibility rules:
 *   - Confirmation / error replies are auto-deleted after the user acts or they expire.
 *   - Execution results are posted publicly and remain in the channel.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const openCloud = require("./openCloudAPI");
const apiCache = require("./utils/apiCache");
const llmCache = require("./utils/llmCache");
const { processCommand } = require("./llmProcessor");
const { sendPaginatedList } = require("./utils/pagination");
const {
  buildResultEmbed,
  buildBanEmbed,
  buildUnbanEmbed,
  buildCheckBanEmbed,
  formatBanEntries,
  buildShowDataEmbed,
  formatJsonValue,
  buildSetDataEmbed,
  buildDeleteDataEmbed,
  formatLeaderboardEntries,
  buildRemoveFromBoardEmbed,
  formatKeyEntries,
  buildErrorEmbed,
} = require("./utils/formatters");

// Keywords that must appear in the message for it to be forwarded to the LLM.
// Anything that doesn't match is silently ignored (no API call, no reply).
const COMMAND_KEYWORDS = [
  "ban", "unban", "remove", "kick",
  "show", "data", "datastore",
  "leaderboard", "list",
  "universe", "user", "player", "entry",
  "check", "status", "banned", "bans",
  "set", "delete", "wipe", "keys",
  // Context-aware keywords (allow follow-up commands)
  "previous", "last", "same", "again", "undo",
];

// ── Per-user-per-channel command history (last N commands) ───────────────
const MAX_HISTORY = 5;
const commandHistory = new Map(); // `${channelId}:${userId}` → [{ action, parameters, timestamp }]

function pushHistory(channelId, userId, action, parameters) {
  const key = `${channelId}:${userId}`;
  if (!commandHistory.has(key)) commandHistory.set(key, []);
  const history = commandHistory.get(key);
  history.push({ action, parameters, timestamp: new Date().toISOString() });
  if (history.length > MAX_HISTORY) history.shift();
}

function getHistory(channelId, userId) {
  return commandHistory.get(`${channelId}:${userId}`) || [];
}

// ── Universe info cache (iconUrl + name, keyed by universeId) ───────────
const universeInfoMap = new Map();

// ── Per-user NLP cooldown ─────────────────────────────────────────────────
const COOLDOWN_MS = 3_000;
const lastCommandTime = new Map(); // userId → timestamp

// ── Safety constraints ────────────────────────────────────────────────────
const ALLOWED_ACTIONS = new Set(["ban", "unban", "showData", "listLeaderboard", "removeFromBoard", "checkBan", "listBans", "setData", "listKeys", "deleteData"]);
const MAX_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 600; // ms between consecutive Roblox API calls in a batch

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

/**
 * Main entry point — call from client.on('messageCreate', ...)
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
async function handleMessage(client, message) {
  // ── Fast ignore conditions (zero cost) ──────────────────────────────────
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const textRaw = message.content.replace(/<@!?\d+>/g, "").trim();
  const textLower = textRaw.toLowerCase();

  // Keyword pre-filter — silently ignore non-command messages
  const looksLikeCommand = COMMAND_KEYWORDS.some(kw => textLower.includes(kw));
  if (!looksLikeCommand) return;

  // ── Permission & setup checks ────────────────────────────────────────────
  if (!message.member?.permissions.has("Administrator")) {
    await replyEmbed(message, "Permission Denied", "You need **Administrator** permission to use this command.");
    return;
  }

  // ── Cooldown check ───────────────────────────────────────────────────────
  const now = Date.now();
  const last = lastCommandTime.get(message.author.id) ?? 0;
  const remaining = COOLDOWN_MS - (now - last);
  if (remaining > 0) {
    await replyEmbed(message, "Slow down", `Please wait **${(remaining / 1000).toFixed(1)}s** before sending another command.`, 0xffa500);
    return;
  }
  lastCommandTime.set(message.author.id, now);

  if (!llmCache.hasLlmKey()) {
    await replyEmbed(message, "Setup Required", "No LLM API key configured.\nAn administrator must run `/setllmkey` first.");
    return;
  }

  if (!textRaw) {
    await replyEmbed(message, "How can I help?", "Try something like:\n`ban user 12345 for cheating in MyGame`", 0x5865f2);
    return;
  }

  // ── LLM parsing ──────────────────────────────────────────────────────────
  let commands;
  try {
    const knownUniverses = apiCache.getCachedUniverses();
    const history = getHistory(message.channel.id, message.author.id);
    commands = await processCommand(textRaw, knownUniverses, history);
  } catch (err) {
    console.error("[NLP] Unexpected error calling processCommand:", err);
    await replyEmbed(message, "Processing Error", "Failed to process your request. Please try again.");
    return;
  }

  // ── Validate all parsed commands ───────────────────────────────────────────
  // If the first command has no action, the whole request was unrecognised
  if (!commands[0]?.action) {
    await replyEmbed(message, "Unrecognised Command", commands[0]?.confirmation_summary || "I couldn't understand that as a command.", 0xffa500);
    return;
  }

  // ── Strict output validation (prompt injection defence) ──────────────────
  // Reject any action not in the known whitelist
  const invalidAction = commands.find(cmd => !ALLOWED_ACTIONS.has(cmd.action));
  if (invalidAction) {
    console.warn(`[NLP] Rejected unknown action "${invalidAction.action}" — possible prompt injection`);
    await replyEmbed(message, "Invalid Command", "The parsed command contains an unrecognised action and was rejected.", 0xff0000);
    return;
  }

  // Reject batch sizes over the cap
  if (commands.length > MAX_BATCH_SIZE) {
    await replyEmbed(message, "Too Many Commands", `Batch requests are limited to **${MAX_BATCH_SIZE} commands** at a time. Your request parsed ${commands.length}.`, 0xff0000);
    return;
  }

  // Data-mutating actions (setData, deleteData) must not be batched
  const DATA_MUTATING_ACTIONS = new Set(["setData", "deleteData"]);
  if (commands.length > 1 && commands.some(cmd => DATA_MUTATING_ACTIONS.has(cmd.action))) {
    await replyEmbed(message, "Cannot Batch Data Writes", "`setData` and `deleteData` commands must be executed one at a time.", 0xff0000);
    return;
  }

  // Reject any universeId not already configured via /setapikey
  const unconfiguredUniverse = commands.find(
    cmd => cmd.parameters.universeId && !apiCache.hasApiKey(cmd.parameters.universeId)
  );
  if (unconfiguredUniverse) {
    await replyEmbed(message, "Unknown Universe", `Universe **${unconfiguredUniverse.parameters.universeId}** has no API key configured.\nOnly universes set up via \`/setapikey\` can be used.`, 0xff0000);
    return;
  }

  // Collect all missing params across commands
  const allMissing = [...new Set(commands.flatMap(cmd => cmd.missing))];
  if (allMissing.length > 0) {
    await replyEmbed(message, "Missing Information", `I need more details to proceed:\n**${allMissing.join(", ")}**`, 0xffa500);
    return;
  }

  // Collect all referenced universe IDs (already verified above)
  const universeIds = [...new Set(commands.map(cmd => cmd.parameters.universeId).filter(Boolean))];

  await Promise.all(universeIds.map(async (uid) => {
    try {
      universeInfoMap.set(uid, await openCloud.GetUniverseName(uid));
    } catch (_) { /* icon is optional */ }
  }));

  // For the confirmation thumbnail, pick the first universe's icon
  const primaryIcon = universeInfoMap.values().next().value?.icon ?? null;
  const isBatch = commands.length > 1;

  // ── Confirmation embed ────────────────────────────────────────────────────
  let confirmEmbed;

  if (isBatch) {
    const summary = commands.map((cmd, i) => `**${i + 1}.** ${cmd.confirmation_summary}`).join("\n");
    confirmEmbed = new EmbedBuilder()
      .setTitle(`Confirm Batch: ${commands.length} ${commands[0].action} commands`)
      .setDescription(summary)
      .setColor(0xffa500)
      .setFooter({ text: "This request expires in 60 seconds" })
      .setTimestamp();
  } else {
    const fields = Object.entries(commands[0].parameters).map(([name, value]) => ({
      name,
      value: String(value),
      inline: true,
    }));
    confirmEmbed = new EmbedBuilder()
      .setTitle(`Confirm: ${commands[0].action}`)
      .setDescription(commands[0].confirmation_summary)
      .setColor(0xffa500)
      .addFields(fields)
      .setFooter({ text: "This request expires in 60 seconds" })
      .setTimestamp();
  }

  if (primaryIcon) {
    confirmEmbed.setThumbnail(primaryIcon);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("nlp_confirm")
      .setLabel(isBatch ? `Confirm All (${commands.length})` : "Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("nlp_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  const reply = await message.reply({ embeds: [confirmEmbed], components: [row] });

  // ── Button collector ──────────────────────────────────────────────────────
  const collector = reply.createMessageComponentCollector({ time: 60_000 });

  collector.on("collect", async (i) => {
    if (i.user.id !== message.author.id) {
      await i.reply({ content: "Only the person who issued this command can confirm it.", ephemeral: true });
      return;
    }

    collector.stop("handled");

    if (i.customId === "nlp_cancel") {
      await i.update({ content: "Cancelled.", embeds: [], components: [] });
      return;
    }

    // Confirm — execute all commands
    try {
      await i.update({
        content: isBatch ? `Executing ${commands.length} commands…` : "Executing…",
        embeds: [],
        components: [],
      });

      const resultEmbeds = [];
      for (const cmd of commands) {
        const iconUrl = universeInfoMap.get(cmd.parameters.universeId)?.icon ?? null;
        const resultEmbed = await executeAction(cmd.action, cmd.parameters, iconUrl, message.channel, message.author.id);
        if (resultEmbed) resultEmbeds.push(resultEmbed);
        pushHistory(message.channel.id, message.author.id, cmd.action, cmd.parameters);
        // Stagger requests to avoid hitting Roblox rate limits on batches
        if (commands.length > 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // Discord allows up to 10 embeds per message — split if needed
      while (resultEmbeds.length > 0) {
        const batch = resultEmbeds.splice(0, 10);
        await message.channel.send({ embeds: batch });
      }

      // Update the confirmation message to reflect completion
      await reply.edit({
        content: isBatch
          ? `Executed ${commands.length} commands.`
          : "Executed.",
      }).catch(() => {});
    } catch (err) {
      console.error("[NLP] Error executing confirmed command:", err);
      await message.channel.send({
        embeds: [buildEmbed("Execution Error", `Something went wrong: ${err.message}`)],
      }).catch(() => {});
    }
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      reply.edit({ components: [] }).catch(() => {});
    }
  });
}

/**
 * Execute a parsed action and return a result embed.
 * For paginated actions (listBans, listKeys) the message is sent directly
 * to the channel and null is returned.
 * @param {string} action
 * @param {object} params
 * @param {string|null} iconUrl
 * @param {import('discord.js').TextChannel} channel
 * @param {string} authorId
 * @returns {Promise<EmbedBuilder|null>}
 */
async function executeAction(action, params, iconUrl, channel, authorId) {
  try {
    let result;
    // Build a minimal universeInfo-like object from the iconUrl for shared formatters
    const universeInfo = { icon: iconUrl, name: null };

    switch (action) {
      case "ban":
        result = await openCloud.BanUser(
          params.userId,
          params.reason,
          params.duration || null,
          params.excludeAlts || false,
          params.universeId
        );
        return buildBanEmbed(result, {
          userId: params.userId,
          universeId: params.universeId,
          reason: params.reason,
          duration: params.duration,
          excludeAltAccounts: params.excludeAlts || false,
        }, universeInfo);

      case "unban":
        result = await openCloud.UnbanUser(params.userId, params.universeId);
        return buildUnbanEmbed(result, { userId: params.userId, universeId: params.universeId }, universeInfo);

      case "showData": {
        result = await openCloud.GetDataStoreEntry(
          params.key,
          params.universeId,
          params.datastoreName
        );
        const showEmbed = buildShowDataEmbed(result, { key: params.key, universeId: params.universeId, datastoreName: params.datastoreName }, universeInfo);
        // For NLP, also add the Value field inline (showData slash command uses a second embed)
        if (result.success) {
          showEmbed.addFields({ name: "Value", value: formatJsonValue(result.data), inline: false });
        }
        return showEmbed;
      }

      case "listLeaderboard": {
        await sendPaginatedList({
          authorId,
          title: `Leaderboard: ${params.leaderboardName}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListOrderedDataStoreEntries(params.leaderboardName, params.scope || "global", pt, params.universeId),
          formatEntries: (data, pageNum) => formatLeaderboardEntries(data, pageNum, { universeId: params.universeId, scope: params.scope || "global" }),
          sendInitial: (opts) => channel.send(opts),
        });
        return null;
      }

      case "removeFromBoard":
        result = await openCloud.RemoveOrderedDataStoreData(
          params.userId,
          params.leaderboardName,
          params.key || String(params.userId),
          params.scope || "global",
          params.universeId
        );
        return buildRemoveFromBoardEmbed(result, {
          userId: params.userId,
          universeId: params.universeId,
          leaderboardName: params.leaderboardName,
          key: params.key,
        }, universeInfo);

      case "checkBan":
        result = await openCloud.CheckBanStatus(params.userId, params.universeId);
        return buildCheckBanEmbed(result, { userId: params.userId, universeId: params.universeId }, universeInfo);

      case "listBans":
        await sendPaginatedList({
          authorId,
          title: `Active Bans — Universe ${params.universeId}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListBans(params.universeId, pt),
          formatEntries: formatBanEntries,
          sendInitial: (opts) => channel.send(opts),
        });
        return null;

      case "setData": {
        let parsedValue = params.value;
        try { parsedValue = JSON.parse(params.value); } catch (_) { /* keep as string */ }
        result = await openCloud.SetDataStoreEntry(
          params.key,
          parsedValue,
          params.universeId,
          params.datastoreName,
          params.scope || "global"
        );
        return buildSetDataEmbed(result, {
          key: params.key,
          universeId: params.universeId,
          datastoreName: params.datastoreName,
          rawValue: params.value,
          scope: params.scope || "global",
        }, universeInfo);
      }

      case "listKeys":
        await sendPaginatedList({
          authorId,
          title: `Keys — ${params.datastoreName}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListDataStoreKeys(params.universeId, params.datastoreName, params.scope || "global", pt),
          formatEntries: (data, pageNum) => formatKeyEntries(data, pageNum, { universeId: params.universeId, scope: params.scope || "global" }),
          sendInitial: (opts) => channel.send(opts),
        });
        return null;

      case "deleteData": {
        const snapshot = await openCloud.GetDataStoreEntry(params.key, params.universeId, params.datastoreName);
        const snapshotText = snapshot.success && snapshot.data !== null
          ? JSON.stringify(snapshot.data, null, 2).slice(0, 900)
          : "Could not retrieve value before deletion.";

        result = await openCloud.DeleteDataStoreEntry(
          params.key,
          params.universeId,
          params.datastoreName,
          params.scope || "global"
        );
        return buildDeleteDataEmbed(result, {
          key: params.key,
          universeId: params.universeId,
          datastoreName: params.datastoreName,
          scope: params.scope || "global",
          snapshotText,
        }, universeInfo);
      }

      default:
        return buildErrorEmbed(`Action "${action}" is not recognised.`);
    }
  } catch (err) {
    console.error(`[NLP] executeAction error (${action}):`, err);
    return buildErrorEmbed(err.message);
  }
}

/**
 * Build a standard result embed.
 * @param {string} title
 * @param {{ success: boolean, status?: string }} result
 * @param {object[]} fields
 * @param {string} [footerText]
 */
module.exports = { handleMessage, pushHistory };
