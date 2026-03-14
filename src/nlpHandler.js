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
 * Send a paginated embed with ◀ ▶ navigation for list-style results.
 * Handles cursor-based API pagination via the fetchPage callback.
 * @param {import('discord.js').TextChannel} channel
 * @param {string} authorId
 * @param {string} title
 * @param {string|null} iconUrl
 * @param {function(string|null): Promise} fetchPage  — receives pageToken, returns API result
 * @param {function(object, number): string} formatEntries  — formats result into display text
 */
async function sendPaginatedEmbed(channel, authorId, title, iconUrl, fetchPage, formatEntries) {
  const pageTokens = [null]; // pageTokens[i] = token to fetch page i (null = first page)
  let currentPage = 0;

  const doPage = async () => {
    const data = await fetchPage(pageTokens[currentPage]);
    if (!data.success) {
      return { embed: buildEmbed("Error", data.status || "Failed to fetch data"), components: [], ok: false };
    }
    // Cache the token for the next page when first discovered
    if (data.nextPageToken && currentPage + 1 >= pageTokens.length) {
      pageTokens.push(data.nextPageToken);
    }
    const hasNext = currentPage + 1 < pageTokens.length;
    const hasPrev = currentPage > 0;
    const pageText = formatEntries(data, currentPage + 1);

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x5865f2)
      .setDescription(pageText || "No entries found.")
      .setFooter({ text: `Page ${currentPage + 1}` })
      .setTimestamp();
    if (iconUrl) embed.setThumbnail(iconUrl);

    const buttons = [];
    if (hasPrev) buttons.push(new ButtonBuilder().setCustomId("pg_prev").setLabel("◀").setStyle(ButtonStyle.Secondary));
    if (hasNext) buttons.push(new ButtonBuilder().setCustomId("pg_next").setLabel("▶").setStyle(ButtonStyle.Secondary));
    const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(...buttons)] : [];

    return { embed, components, ok: true };
  };

  const initial = await doPage();
  const msg = await channel.send({ embeds: [initial.embed], components: initial.components });
  if (!initial.ok || initial.components.length === 0) return;

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === authorId,
    time: 120_000,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "pg_prev") currentPage--;
    else currentPage++;
    await i.deferUpdate();
    const { embed, components } = await doPage();
    await msg.edit({ embeds: [embed], components }).catch(() => {});
  });

  collector.on("end", () => {
    msg.edit({ components: [] }).catch(() => {});
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

    switch (action) {
      case "ban":
        result = await openCloud.BanUser(
          params.userId,
          params.reason,
          params.duration || null,
          params.excludeAlts || false,
          params.universeId
        );
        return buildResultEmbed(
          `Ban User: ${params.userId}`,
          result,
          [
            { name: "User ID", value: String(params.userId), inline: true },
            { name: "Reason", value: params.reason, inline: true },
            { name: "Duration", value: params.duration || "permanent", inline: true },
            { name: "Exclude Alts", value: params.excludeAlts ? "Yes" : "No", inline: true },
          ],
          result.success
            ? result.expiresDate
              ? `Banned until ${result.expiresDate.toLocaleString()}`
              : "Banned permanently"
            : result.status,
          iconUrl
        );

      case "unban":
        result = await openCloud.UnbanUser(params.userId, params.universeId);
        return buildResultEmbed(
          `Unban User: ${params.userId}`,
          result,
          [
            { name: "User ID", value: String(params.userId), inline: true },
            { name: "Universe ID", value: String(params.universeId), inline: true },
          ],
          undefined,
          iconUrl
        );

      case "showData":
        result = await openCloud.GetDataStoreEntry(
          params.key,
          params.universeId,
          params.datastoreName
        );
        return buildResultEmbed(
          "Datastore Entry",
          result,
          result.success
            ? [
                { name: "Key", value: params.key, inline: true },
                { name: "Datastore", value: params.datastoreName, inline: true },
                {
                  name: "Value",
                  value: String(JSON.stringify(result.data)).slice(0, 1024),
                  inline: false,
                },
              ]
            : [],
          undefined,
          iconUrl
        );

      case "listLeaderboard": {
        result = await openCloud.ListOrderedDataStoreEntries(
          params.leaderboardName,
          params.scope || "global",
          null,
          params.universeId
        );
        const entries = result.success && Array.isArray(result.entries)
          ? result.entries
              .map((e, i) => `${i + 1}. \`${e.id}\` — ${e.value}`)
              .join("\n")
              .slice(0, 1024) || "No entries found."
          : "No entries found.";
        return buildResultEmbed(
          `Leaderboard: ${params.leaderboardName}`,
          result,
          [{ name: "Top Entries", value: entries, inline: false }],
          undefined,
          iconUrl
        );
      }

      case "removeFromBoard":
        result = await openCloud.RemoveOrderedDataStoreData(
          params.userId,
          params.leaderboardName,
          params.key || String(params.userId),
          params.scope || "global",
          params.universeId
        );
        return buildResultEmbed(
          `Remove from Leaderboard: ${params.leaderboardName}`,
          result,
          [
            { name: "User ID", value: String(params.userId), inline: true },
            { name: "Leaderboard", value: params.leaderboardName, inline: true },
          ],
          undefined,
          iconUrl
        );

      case "checkBan": {
        result = await openCloud.CheckBanStatus(params.userId, params.universeId);
        const isActive = result.success && result.active;
        const banFields = [
          { name: "User ID", value: String(params.userId), inline: true },
          { name: "Status", value: isActive ? "Banned" : "Not Banned", inline: true },
        ];
        if (isActive) {
          if (result.reason) banFields.push({ name: "Reason", value: result.reason, inline: false });
          banFields.push({ name: "Banned At", value: result.startTime ? result.startTime.toLocaleString() : "Unknown", inline: true });
          banFields.push({ name: "Expires", value: result.expiresDate ? result.expiresDate.toLocaleString() : "Permanent", inline: true });
          banFields.push({ name: "Alt Ban", value: result.excludeAltAccounts ? "Yes" : "No", inline: true });
        }
        return buildResultEmbed(`Ban Status: User ${params.userId}`, result, banFields, undefined, iconUrl);
      }

      case "listBans":
        await sendPaginatedEmbed(
          channel,
          authorId,
          `Active Bans — Universe ${params.universeId}`,
          iconUrl,
          (pt) => openCloud.ListBans(params.universeId, pt),
          (data) => (data.bans || [])
            .map(b => {
              const uid = b.user?.replace("users/", "") ?? "?";
              const r = b.gameJoinRestriction ?? {};
              const reason = (r.displayReason || r.privateReason || "No reason").slice(0, 60);
              let expires = "Permanent";
              if (r.duration && r.startTime) {
                const expDt = new Date(new Date(r.startTime).getTime() + parseInt(r.duration, 10) * 1000);
                expires = expDt.toLocaleDateString();
              }
              return `**${uid}** — ${reason} *(${expires})*`;
            })
            .join("\n") || "No active bans."
        );
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
        return buildResultEmbed(
          `Set Datastore Entry: ${params.key}`,
          result,
          result.success
            ? [
                { name: "Key", value: params.key, inline: true },
                { name: "Datastore", value: params.datastoreName, inline: true },
                { name: "New Value", value: String(params.value).slice(0, 200), inline: false },
              ]
            : [],
          undefined,
          iconUrl
        );
      }

      case "listKeys":
        await sendPaginatedEmbed(
          channel,
          authorId,
          `Keys — ${params.datastoreName}`,
          iconUrl,
          (pt) => openCloud.ListDataStoreKeys(params.universeId, params.datastoreName, params.scope || "global", pt),
          (data) => (data.keys || []).map(k => `\`${k}\``).join("\n") || "No keys found."
        );
        return null;

      case "deleteData": {
        // Snapshot the value before deleting so the admin can restore if needed
        const snapshot = await openCloud.GetDataStoreEntry(params.key, params.universeId, params.datastoreName);
        const snapshotText = snapshot.success && snapshot.data !== null
          ? String(JSON.stringify(snapshot.data)).slice(0, 900)
          : "Could not retrieve value before deletion.";

        result = await openCloud.DeleteDataStoreEntry(
          params.key,
          params.universeId,
          params.datastoreName,
          params.scope || "global"
        );
        return buildResultEmbed(
          `Delete Datastore Entry: ${params.key}`,
          result,
          result.success
            ? [
                { name: "Key", value: params.key, inline: true },
                { name: "Datastore", value: params.datastoreName, inline: true },
                { name: "Value Before Deletion", value: `\`\`\`json\n${snapshotText}\n\`\`\``, inline: false },
                { name: "⚠️ Warning", value: "This entry is permanently deleted. Use `setData` with the value above to restore it.", inline: false },
              ]
            : [],
          undefined,
          iconUrl
        );
      }

      default:
        return new EmbedBuilder()
          .setTitle("Unknown Action")
          .setColor(0xff0000)
          .setDescription(`Action "${action}" is not recognised.`)
          .setTimestamp();
    }
  } catch (err) {
    console.error(`[NLP] executeAction error (${action}):`, err);
    return new EmbedBuilder()
      .setTitle("Error")
      .setColor(0xff0000)
      .setDescription(`An error occurred: ${err.message}`)
      .setTimestamp();
  }
}

/**
 * Build a standard result embed.
 * @param {string} title
 * @param {{ success: boolean, status?: string }} result
 * @param {object[]} fields
 * @param {string} [footerText]
 */
function buildResultEmbed(title, result, fields = [], footerText = "", iconUrl = null) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(result.success ? 0x00ff00 : 0xff0000)
    .addFields(fields)
    .setTimestamp();

  const footer = footerText || result.status || (result.success ? "Success" : "Failed");
  embed.setFooter({ text: footer });

  if (iconUrl) {
    embed.setThumbnail(iconUrl);
  }

  return embed;
}

module.exports = { handleMessage, pushHistory };
