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

/** Silently delete a message (best-effort). */
function tryDelete(msg) {
  msg.delete().catch(() => {});
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
    const reply = await message.reply({ content: "❌ Administrator permission required." });
    setTimeout(() => { tryDelete(reply); }, 5000);
    return;
  }

  if (!llmCache.hasLlmKey()) {
    const reply = await message.reply({
      content: "❌ No LLM API key configured. An administrator must run `/setllmkey` first.",
    });
    setTimeout(() => { tryDelete(reply); }, 5000);
    return;
  }

  if (!textRaw) {
    const reply = await message.reply({
      content: "How can I help? Try something like: `ban user 12345 for cheating in MyGame`",
    });
    setTimeout(() => { tryDelete(reply); }, 10000);
    return;
  }

  // ── LLM parsing ──────────────────────────────────────────────────────────
  let parsed;
  try {
    const knownUniverses = apiCache.getCachedUniverses();
    const history = getHistory(message.channel.id);
    parsed = await processCommand(textRaw, knownUniverses, history);
  } catch (err) {
    console.error("[NLP] Unexpected error calling processCommand:", err);
    const reply = await message.reply({ content: "❌ Failed to process your request. Please try again." });
    setTimeout(() => { tryDelete(reply); }, 5000);
    return;
  }

  // ── Handle LLM response ───────────────────────────────────────────────────
  if (!parsed.action) {
    const reply = await message.reply({ content: parsed.confirmation_summary || "I couldn't understand that as a command." });
    setTimeout(() => { tryDelete(reply); }, 10000);
    return;
  }

  if (parsed.missing.length > 0) {
    const reply = await message.reply({
      content: `I need more information to proceed. Missing: **${parsed.missing.join(", ")}**`,
    });
    setTimeout(() => { tryDelete(reply); }, 10000);
    return;
  }

  const { universeId } = parsed.parameters;
  if (universeId && !apiCache.hasApiKey(universeId)) {
    const reply = await message.reply({ embeds: [apiCache.createMissingApiKeyEmbed(universeId)] });
    setTimeout(() => { tryDelete(reply); }, 10000);
    return;
  }

  // ── Confirmation embed ────────────────────────────────────────────────────
  const fields = Object.entries(parsed.parameters).map(([name, value]) => ({
    name,
    value: String(value),
    inline: true,
  }));

  const confirmEmbed = new EmbedBuilder()
    .setTitle(`Confirm: ${parsed.action}`)
    .setDescription(parsed.confirmation_summary)
    .setColor(0xffa500)
    .addFields(fields)
    .setFooter({ text: "This request expires in 60 seconds" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("nlp_confirm")
      .setLabel("Confirm")
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
      tryDelete(reply);
      return;
    }

    // Confirm — execute
    await i.update({ content: "Executing…", embeds: [], components: [] });

    const resultEmbed = await executeAction(parsed.action, parsed.parameters);

    // Save to history for context in future commands
    pushHistory(message.channel.id, parsed.action, parsed.parameters);

    // Post result publicly in the channel, then delete the confirmation
    await message.channel.send({ embeds: [resultEmbed] });
    tryDelete(reply);
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      tryDelete(reply);
    }
  });
}

/**
 * Execute a parsed action and return a result embed.
 * @param {string} action
 * @param {object} params
 * @returns {Promise<EmbedBuilder>}
 */
async function executeAction(action, params) {
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
            : result.status
        );

      case "unban":
        result = await openCloud.UnbanUser(params.userId, params.universeId);
        return buildResultEmbed(
          `Unban User: ${params.userId}`,
          result,
          [
            { name: "User ID", value: String(params.userId), inline: true },
            { name: "Universe ID", value: String(params.universeId), inline: true },
          ]
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
            : []
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
          [{ name: "Top Entries", value: entries, inline: false }]
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
          ]
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
function buildResultEmbed(title, result, fields = [], footerText = "") {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(result.success ? 0x00ff00 : 0xff0000)
    .addFields(fields)
    .setTimestamp();

  const footer = footerText || result.status || (result.success ? "Success" : "Failed");
  embed.setFooter({ text: footer });

  return embed;
}

module.exports = { handleMessage };
