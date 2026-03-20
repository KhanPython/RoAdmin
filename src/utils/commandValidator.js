// Shared command validation middleware
// Eliminates duplicated input validation and error-response logic across command files.

"use strict";

const { MessageFlags } = require("discord.js");
const apiCache = require("./apiCache");
const universeUtils = require("./universeUtils");
const openCloud = require("../openCloudAPI");


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

  if (opts.leaderboardName !== undefined) {
    if (!opts.leaderboardName || !SCOPE_RE.test(opts.leaderboardName)) {
      return { valid: false, errorString: "Leaderboard name must be 1\u2013100 alphanumeric characters, dashes, or underscores." };
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

module.exports = { validateCommand };
