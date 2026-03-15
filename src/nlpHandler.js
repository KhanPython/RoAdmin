// NLP handler - parses @mention messages via Anthropic, shows confirmation, and executes commands

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const openCloud = require("./openCloudAPI");
const apiCache = require("./utils/apiCache");
const log = require("./utils/logger");
const llmCache = require("./utils/llmCache");
const { processCommand, patchDatastoreValue } = require("./llmProcessor");
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
  buildUpdateDataEmbed,
  formatLeaderboardEntries,
  buildRemoveFromBoardEmbed,
  formatKeyEntries,
  buildErrorEmbed,
  buildProcessingEmbed,
} = require("./utils/formatters");
const { scheduleAutoDelete } = require("./utils/autoDelete");

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

const COOLDOWN_MS = 3_000;
const lastCommandTime = new Map(); // userId → timestamp

const ALLOWED_ACTIONS = new Set(["ban", "unban", "showData", "listLeaderboard", "removeFromBoard", "checkBan", "listBans", "setData", "updateData", "listKeys"]);
const MAX_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 600; // ms between consecutive Roblox API calls in a batch

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

  const textRaw = message.content.replace(/<@!?\d+>/g, "").trim();
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
    const keystore = require("./utils/keystore");
    const consentStatus = message.guild && apiCache.hasConsent(message.guild.id);
    const storageMode = keystore.isEnabled() ? "Encrypted at rest" : "Memory-only (session)";
    const embed = new EmbedBuilder()
      .setTitle(app.name || "RoAdmin")
      .setDescription(app.description || "A Discord bot for managing Roblox experiences via Open Cloud API.")
      .setColor(0x5865f2)
      .addFields(
        { name: "Version", value: "1.0.0", inline: true },
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

  if (!message.member?.permissions.has("Administrator")) {
    await replyEmbed(message, "Permission Denied", "You need **Administrator** permission to use this command.");
    return;
  }

  if (message.guild && !apiCache.hasConsent(message.guild.id)) {
    const consentEmbed = new EmbedBuilder()
      .setTitle("Data Processing Consent Required")
      .setDescription(
        "To use natural language commands, this bot sends your message text to **Anthropic (Claude AI)** for processing.\n\n" +
        "**What is shared with Anthropic:**\n" +
        "\u2022 Your message text (the command you type)\n" +
        "\u2022 Recent command history for context\n\n" +
        "**What is shared with Roblox:**\n" +
        "\u2022 Your Discord user ID is attached to ban actions as an audit trail\n\n" +
        "**What is NOT shared:**\n" +
        "\u2022 Your Discord username\n" +
        "\u2022 API keys or credentials\n\n" +
        "**Data retention:**\n" +
        "\u2022 Command history is stored in memory only and cleared on restart\n" +
        "\u2022 You can delete all data at any time with `/forgetme`\n\n" +
        "A server administrator must accept to enable NLP commands."
      )
      .setColor(0x5865f2)
      .setFooter({ text: "Consent can be revoked at any time with /forgetme" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("consent_accept")
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("consent_decline")
        .setLabel("Decline")
        .setStyle(ButtonStyle.Secondary)
    );

    const consentReply = await message.reply({ embeds: [consentEmbed], components: [row] });
    const consentCollector = consentReply.createMessageComponentCollector({ time: 120_000 });

    consentCollector.on("collect", async (ci) => {
      if (!ci.member?.permissions.has("Administrator")) {
        await ci.reply({ content: "Only an administrator can accept data processing consent.", ephemeral: true });
        return;
      }
      consentCollector.stop("handled");

      if (ci.customId === "consent_accept") {
        apiCache.setConsent(message.guild.id, ci.user.id);
        await ci.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("Consent Accepted")
              .setDescription("NLP commands are now enabled for this server. Please re-send your command.")
              .setColor(0x00ff00)
              .setTimestamp(),
          ],
          components: [],
        });
      } else {
        await ci.update({
          content: "Consent declined. NLP commands will not be available. Slash commands (e.g. `/ban`, `/showData`) still work normally.",
          embeds: [],
          components: [],
        });
      }
    });

    consentCollector.on("end", (_, reason) => {
      if (reason === "time") consentReply.edit({ components: [] }).catch(() => {});
    });
    return;
  }

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

  // Send thinking indicator immediately before the slow LLM call
  const thinkingReply = await message.reply({ embeds: [buildProcessingEmbed("Analyzing your request. This may take a moment.")] });

  const editThinkingError = async (title, description, color = 0xff0000) => {
    return thinkingReply.edit({ embeds: [buildEmbed(title, description, color)], components: [] });
  };

  let commands;
  try {
    const knownUniverses = apiCache.getCachedUniverses();
    const history = getHistory(message.channel.id, message.author.id);
    commands = await processCommand(textRaw, knownUniverses, history);
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
    cmd => cmd.parameters.universeId && !apiCache.hasApiKey(cmd.parameters.universeId)
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
      universeInfoMap.set(uid, await openCloud.GetUniverseName(uid));
    } catch (_) { /* icon is optional */ }
  }));

  // Collapse consecutive updateData commands on the same entry into one operation
  commands = mergeConsecutiveUpdateData(commands);

  // For the confirmation thumbnail and experience link, pick the first universe's info
  const primaryInfo = universeInfoMap.values().next().value ?? {};
  const primaryIcon = primaryInfo.icon ?? null;
  const primaryName = primaryInfo.name ?? null;
  const isBatch = commands.length > 1;

  let confirmEmbed;

  if (isBatch) {
    const summary = commands.map((cmd, i) => `**${i + 1}.** ${cmd.confirmation_summary}`).join("\n");
    const distinctActions = [...new Set(commands.map(c => c.action))];
    const actionLabel = distinctActions.length === 1
      ? `${commands.length} ${distinctActions[0]}`
      : `${commands.length} commands (${distinctActions.join(", ")})`;
    const batchDesc = primaryName ? `**Experience:** ${primaryName}\n\n${summary}` : summary;
    confirmEmbed = new EmbedBuilder()
      .setTitle(`Confirm Batch: ${actionLabel}`)
      .setDescription(batchDesc)
      .setColor(0xffa500)
      .setFooter({ text: "This request expires in 60 seconds" })
      .setTimestamp();
  } else {
    const fields = Object.entries(commands[0].parameters).map(([name, value]) => ({
      name,
      value: String(value),
      inline: true,
    }));
    const singleDesc = primaryName
      ? `**Experience:** ${primaryName}\n\n${commands[0].confirmation_summary}`
      : commands[0].confirmation_summary;
    confirmEmbed = new EmbedBuilder()
      .setTitle(`Confirm: ${commands[0].action}`)
      .setDescription(singleDesc)
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

  await thinkingReply.edit({ embeds: [confirmEmbed], components: [row] });
  const reply = thinkingReply;

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

    // Confirm - execute all commands
    try {
      const processingDesc = isBatch
        ? `Executing ${commands.length} commands…`
        : "Executing command…";
      const processingEmbed = EmbedBuilder.from(i.message.embeds[0])
        .setTitle("Processing...")
        .setDescription(processingDesc)
        .setColor(0x5865f2)
        .setFooter(null);
      await i.update({ embeds: [processingEmbed], components: [] });

      const resultEmbeds = [];
      for (const cmd of commands) {
        const universeInfo = universeInfoMap.get(cmd.parameters.universeId) ?? { icon: null, name: null };
        const resultEmbed = await executeAction(cmd.action, cmd.parameters, universeInfo, message.channel, message.author.id);
        if (resultEmbed) resultEmbeds.push(resultEmbed);
        pushHistory(message.channel.id, message.author.id, cmd.action, cmd.parameters);
        // Stagger requests to avoid hitting Roblox rate limits on batches
        if (commands.length > 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // Discord allows up to 10 embeds per message - split if needed
      while (resultEmbeds.length > 0) {
        const batch = resultEmbeds.splice(0, 10);
        await message.channel.send({ embeds: batch });
      }

      // Remove the confirmation message now that results are shown
      await reply.delete().catch(() => {});
    } catch (err) {
      log.error("Error executing confirmed command:", err.message);
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

// Execute a parsed action and return a result embed (null for paginated actions)
async function executeAction(action, params, universeInfo, channel, authorId) {
  try {
    let result;
    const iconUrl = universeInfo?.icon ?? null;

    switch (action) {
      case "ban":
        result = await openCloud.BanUser(
          params.userId,
          params.reason,
          params.duration || null,
          params.excludeAlts || false,
          params.universeId,
          authorId
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
        if (result.success && result.data !== null && result.data !== undefined) {
          showEmbed.setFooter({ text: "This message will be auto-deleted in 2 minutes" });
          const jsonString = JSON.stringify(result.data, null, 2);
          const { AttachmentBuilder } = require("discord.js");
          const fileBuffer = Buffer.from(jsonString, "utf-8");
          const attachment = new AttachmentBuilder(fileBuffer, { name: `${params.key}_data.txt` });
          const sentMsg = await channel.send({ embeds: [showEmbed], files: [attachment] });
          scheduleAutoDelete(sentMsg);
        } else {
          showEmbed.addFields({ name: "Value", value: "No data found for this key.", inline: false });
          await channel.send({ embeds: [showEmbed] });
        }
        return null;
      }

      case "listLeaderboard": {
        await sendPaginatedList({
          authorId,
          title: `Leaderboard: ${params.leaderboardName}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListOrderedDataStoreEntries(params.leaderboardName, params.scope || "global", pt, params.universeId),
          formatEntries: (data, pageNum) => formatLeaderboardEntries(data, pageNum, { universeId: params.universeId, scope: params.scope || "global", universeName: universeInfo?.name ?? null }),
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
          title: `Active Bans - Universe ${params.universeId}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListBans(params.universeId, pt),
          formatEntries: (data, pageNum) => formatBanEntries(data, pageNum, { universeName: universeInfo?.name ?? null }),
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

      case "updateData": {
        // 1. Fetch the current value once (works for both single and merged multi-field updates)
        const fetchResult = await openCloud.GetDataStoreEntry(
          params.key,
          params.universeId,
          params.datastoreName
        );
        if (!fetchResult.success || fetchResult.data === null || fetchResult.data === undefined) {
          return buildErrorEmbed(`Could not fetch current data for key \"${params.key}\" - ${fetchResult.status || "entry not found"}.`);
        }

        const currentValue = fetchResult.data;
        if (typeof currentValue !== "object" || currentValue === null) {
          return buildErrorEmbed(`The value for key \"${params.key}\" is not a JSON object (it's a ${typeof currentValue}). Use \`setData\` to replace it entirely.`);
        }

        // 2. Build one combined instruction covering all field changes, then patch in a single LLM call
        const instruction = params.fields
          .map(f => `Set the field "${f.field}" to ${f.newValue}`)
          .join(". ");
        const { patched, summary } = await patchDatastoreValue(currentValue, instruction);
        if (!patched) {
          return buildErrorEmbed(`Could not apply update: ${summary}`);
        }

        // 3. Single write back regardless of how many fields changed
        result = await openCloud.SetDataStoreEntry(
          params.key,
          patched,
          params.universeId,
          params.datastoreName,
          params.scope || "global"
        );

        return buildUpdateDataEmbed(result, {
          key: params.key,
          universeId: params.universeId,
          datastoreName: params.datastoreName,
          summary,
          scope: params.scope || "global",
        }, universeInfo);
      }

      case "listKeys":
        await sendPaginatedList({
          authorId,
          title: `Keys - ${params.datastoreName}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListDataStoreKeys(params.universeId, params.datastoreName, params.scope || "global", pt),
          formatEntries: (data, pageNum) => formatKeyEntries(data, pageNum, { universeId: params.universeId, scope: params.scope || "global", universeName: universeInfo?.name ?? null }),
          sendInitial: (opts) => channel.send(opts),
        });
        return null;

      default:
        return buildErrorEmbed(`Action "${action}" is not recognised.`);
    }
  } catch (err) {
    log.error(`executeAction error (${action}):`, err.message);
    return buildErrorEmbed(err.message);
  }
}

module.exports = { handleMessage, pushHistory, clearUserHistory, clearChannelHistories };
