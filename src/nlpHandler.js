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
  // Context-aware keywords (allow follow-up commands)
  "previous", "last", "same", "again", "undo",
];

// ── Per-channel command history (last N commands) ─────────────────────────
const MAX_HISTORY = 5;
const commandHistory = new Map(); // channelId → [{ action, parameters, timestamp }]

function pushHistory(channelId, action, parameters) {
  if (!commandHistory.has(channelId)) commandHistory.set(channelId, []);
  const history = commandHistory.get(channelId);
  history.push({ action, parameters, timestamp: new Date().toISOString() });
  if (history.length > MAX_HISTORY) history.shift();
}

function getHistory(channelId) {
  return commandHistory.get(channelId) || [];
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
    const history = getHistory(message.channel.id);
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

  // Collect all missing params across commands
  const allMissing = [...new Set(commands.flatMap(cmd => cmd.missing))];
  if (allMissing.length > 0) {
    await replyEmbed(message, "Missing Information", `I need more details to proceed:\n**${allMissing.join(", ")}**`, 0xffa500);
    return;
  }

  // Check API keys for all referenced universes
  const universeIds = [...new Set(commands.map(cmd => cmd.parameters.universeId).filter(Boolean))];
  for (const uid of universeIds) {
    if (!apiCache.hasApiKey(uid)) {
      await replyEmbed(message, "API Key Missing", `No API key cached for Universe **${uid}**.\nUse \`/setapikey\` to configure one.`);
      return;
    }
  }

  // ── Fetch experience info for all referenced universes ─────────────────────
  const universeInfoMap = new Map(); // universeId → { name, icon, ... }
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
    await i.update({
      content: isBatch ? `Executing ${commands.length} commands…` : "Executing…",
      embeds: [],
      components: [],
    });

    const resultEmbeds = [];
    for (const cmd of commands) {
      const iconUrl = universeInfoMap.get(cmd.parameters.universeId)?.icon ?? null;
      const resultEmbed = await executeAction(cmd.action, cmd.parameters, iconUrl);
      resultEmbeds.push(resultEmbed);
      pushHistory(message.channel.id, cmd.action, cmd.parameters);
    }

    // Discord allows up to 10 embeds per message — split if needed
    while (resultEmbeds.length > 0) {
      const batch = resultEmbeds.splice(0, 10);
      await message.channel.send({ embeds: batch });
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
 * @param {string} action
 * @param {object} params
 * @returns {Promise<EmbedBuilder>}
 */
async function executeAction(action, params, iconUrl) {
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
        const entries = result.success && Array.isArray(result.data?.entries)
          ? result.data.entries
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

module.exports = { handleMessage };
