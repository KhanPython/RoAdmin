// Shared command validation middleware
// Eliminates duplicated input validation and error-response logic across command files.

"use strict";

const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const apiCache = require("./apiCache");
const universeUtils = require("./universeUtils");
const openCloud = require("../openCloudAPI");
const llmCache = require("./llmCache");
const log = require("./logger");

const DURATION_UNITS = ["d", "m", "y", "h"];
const SCOPE_RE = /^[a-zA-Z0-9_-]{1,100}$/;

/**
 * Validate command inputs and defer the interaction.
 *
 * Pre-defer format checks return `{ valid: false, errorString }` so WOKCommands
 * can render the plain-text error.  Post-defer state checks (API key, universe
 * existence) call `interaction.editReply` directly and return `{ valid: false }`.
 *
 * On success returns `{ valid: true, deferred: true, universeInfo }`.
 *
 * @param {import("discord.js").CommandInteraction} interaction
 * @param {object} opts
 * @param {number|string}  [opts.userId]          – validated with isNaN
 * @param {number|string}  [opts.universeId]      – validated with isNaN
 * @param {string}         [opts.datastoreName]   – must be non-empty
 * @param {string}         [opts.key]             – must be non-empty
 * @param {string}         [opts.rawValue]        – must be non-empty
 * @param {string}         [opts.duration]        – optional, validated for format
 * @param {boolean}        [opts.requireApiKey]   – check apiCache.hasApiKey
 * @param {boolean}        [opts.requireUniverse] – verify universe via API
 */
async function validateCommand(interaction, opts = {}) {
  // --- Pre-defer format checks (sync, return plain string) ---

  if (opts.userId !== undefined) {
    if (!opts.userId || isNaN(opts.userId)) {
      return { valid: false, errorString: "Please provide a valid user ID." };
    }
  }

  if (opts.universeId !== undefined) {
    if (!opts.universeId || isNaN(opts.universeId)) {
      return { valid: false, errorString: "Please provide a valid Universe ID." };
    }
  }

  if (opts.datastoreName !== undefined) {
    if (!opts.datastoreName || String(opts.datastoreName).trim().length === 0) {
      return { valid: false, errorString: "Please provide a datastore name." };
    }
  }

  if (opts.key !== undefined) {
    if (!opts.key || String(opts.key).trim().length === 0) {
      return { valid: false, errorString: "Please provide a valid entry key." };
    }
  }

  if (opts.rawValue !== undefined) {
    if (!opts.rawValue || String(opts.rawValue).trim().length === 0) {
      return { valid: false, errorString: "Please provide a value to store." };
    }
  }

  if (opts.scope !== undefined && opts.scope !== null) {
    if (!SCOPE_RE.test(opts.scope)) {
      return { valid: false, errorString: "Scope must be 1–100 alphanumeric characters, dashes, or underscores." };
    }
  }

  if (opts.duration) {
    if (opts.duration.length > 20) {
      return { valid: false, errorString: "Duration is too long. Example: \"7d\", \"2m\", \"1y\"." };
    }
    const split = opts.duration.match(/\d+|\D+/g);
    if (!split || split.length !== 2) {
      return { valid: false, errorString: 'Invalid time format! Example format: "7d" where "d" = days, "m" = months, "y" = years.' };
    }
    const num = parseInt(split[0], 10);
    if (isNaN(num) || num <= 0) {
      return { valid: false, errorString: "Duration must be a positive number." };
    }
    const type = split[1].toLowerCase();
    if (!DURATION_UNITS.includes(type)) {
      return { valid: false, errorString: 'Please use "d" (days), "m" (months), "y" (years), or "h" (hours) for duration' };
    }
    // Cap at 10 years to prevent absurd ban durations
    const MAX_DAYS = 3650;
    const dayEquiv = type === "y" ? num * 365 : type === "m" ? num * 30 : type === "h" ? num / 24 : num;
    if (dayEquiv > MAX_DAYS) {
      return { valid: false, errorString: "Duration cannot exceed 10 years." };
    }
  }

  // --- Defer the interaction ---
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // --- Post-defer state checks (async, editReply on failure) ---

  if (opts.requireApiKey) {
    if (!openCloud.hasApiKey(interaction.guildId, opts.universeId)) {
      await interaction.editReply({ embeds: [apiCache.createMissingApiKeyEmbed(opts.universeId)] });
      return { valid: false, deferred: true };
    }
  }

  let universeInfo = null;
  if (opts.requireUniverse) {
    const universeCheck = await universeUtils.verifyUniverseExists(openCloud, opts.universeId);
    if (!universeCheck.success) {
      await interaction.editReply({ content: universeCheck.errorMessage });
      return { valid: false, deferred: true };
    }
    universeInfo = universeCheck.universeInfo;
  }

  return { valid: true, deferred: true, universeInfo };
}

module.exports = { validateCommand, validateNlpPrerequisites };

const COOLDOWN_MS = 3_000;
const MAX_COOLDOWN_KEYS = 10_000;
const lastCommandTime = new Map(); // userId → timestamp

/**
 * Validate NLP handler prerequisites: permission, consent, cooldown, LLM key.
 *
 * Returns `{ valid: true }` when all checks pass.
 * On failure returns `{ valid: false }` after posting the appropriate reply/UI.
 *
 * The consent flow (button interaction) is self-contained inside this function.
 *
 * @param {import("discord.js").Message} message
 * @param {import("discord.js").Client} client – only used for consent UI collector
 */
async function validateNlpPrerequisites(message) {
  if (!message.member?.permissions.has("Administrator")) {
    await _replyEmbed(message, "Permission Denied", "You need **Administrator** permission to use this command.");
    return { valid: false };
  }

  if (message.guild && !apiCache.hasConsent(message.guild.id)) {
    const accepted = await _showConsentFlow(message);
    if (!accepted) return { valid: false };
    // Consent was just accepted - tell user to re-send (mirrors original behaviour)
    return { valid: false };
  }

  const now = Date.now();
  const last = lastCommandTime.get(message.author.id) ?? 0;
  const remaining = COOLDOWN_MS - (now - last);
  if (remaining > 0) {
    await _replyEmbed(message, "Slow down", `Please wait **${(remaining / 1000).toFixed(1)}s** before sending another command.`, 0xffa500);
    return { valid: false };
  }
  if (lastCommandTime.size >= MAX_COOLDOWN_KEYS) lastCommandTime.clear();
  lastCommandTime.set(message.author.id, now);

  if (!llmCache.hasLlmKey(message.guildId)) {
    await _replyEmbed(message, "Setup Required", "No LLM API key configured.\nAn administrator must run `/setllmkey` first.");
    return { valid: false };
  }

  return { valid: true };
}

// --- internal helpers ---

function _replyEmbed(message, title, description, color = 0xff0000) {
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp(),
    ],
  });
}

async function _showConsentFlow(message) {
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

  return new Promise((resolve) => {
    let settled = false;

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

    consentCollector.on("end", (_, reason) => {
      if (reason === "time") consentReply.edit({ components: [] }).catch(() => {});
      if (!settled) resolve(false);
    });
  });
}
