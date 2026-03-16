"use strict";

const { EmbedBuilder } = require("discord.js");
const log = require("./logger");

const DATA_AUTO_DELETE_MS = 120_000; // 2 minutes

/**
 * Schedule auto-deletion of a message after a timeout.
 * @param {import("discord.js").Message} message
 * @param {number} [timeoutMs]
 */
function scheduleAutoDelete(message, timeoutMs = DATA_AUTO_DELETE_MS) {
  setTimeout(() => {
    message.delete().catch((err) => {
      log.debug("Auto-delete failed (already deleted?):", err.message);
    });
  }, timeoutMs);
}

// Fields that contain raw player data and must be redacted after the privacy window.
const SENSITIVE_FIELDS = new Set(["Value", "Data Size"]);

/**
 * After timeoutMs, edit the message in-place: replace sensitive data fields with
 * a privacy-compliance notice and strip all file attachments. The embed (key,
 * datastore, universe ID, status) remains visible.
 * @param {import("discord.js").Message} message
 * @param {number} [timeoutMs]
 */
function scheduleDataRedact(message, timeoutMs = DATA_AUTO_DELETE_MS) {
  setTimeout(async () => {
    try {
      const original = message.embeds[0];
      if (!original) return;

      const filteredFields = (original.fields ?? []).filter(f => !SENSITIVE_FIELDS.has(f.name));
      filteredFields.push({ name: "Data", value: "Data expired for privacy compliance.", inline: false });

      const redacted = EmbedBuilder.from(original)
        .setColor(0x808080)
        .setFields(filteredFields)
        .setFooter({ text: "Data fields redacted for privacy compliance" });

      await message.edit({ embeds: [redacted], attachments: [] });
    } catch (err) {
      log.debug("Data redact failed:", err.message);
    }
  }, timeoutMs);
}

module.exports = { scheduleAutoDelete, scheduleDataRedact, DATA_AUTO_DELETE_MS };
