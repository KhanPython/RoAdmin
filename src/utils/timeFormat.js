"use strict";

// Compact human-readable duration formatting (e.g. "5m", "1m 30s", "2h 5m", "1d 4h").
// Used everywhere the bot needs to display elapsed/remaining time to users.

/**
 * Format a millisecond duration as a compact short-form string.
 * Drops zero-valued units except the smallest one. Always returns at least
 * one unit ("0s" for zero / negative input).
 *
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";

  const totalSeconds = Math.round(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  // Show seconds only when nothing larger is present, or when sub-minute precision matters.
  if (s > 0 && d === 0 && h === 0) parts.push(`${s}s`);

  return parts.length > 0 ? parts.join(" ") : "0s";
}

module.exports = { formatDuration };
