"use strict";

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

module.exports = { scheduleAutoDelete, DATA_AUTO_DELETE_MS };
