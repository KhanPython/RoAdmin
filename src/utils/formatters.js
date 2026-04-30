// Discord embed builders for all command result types

"use strict";

const { EmbedBuilder } = require("discord.js");
const { formatDuration } = require("./timeFormat");
const { formatUserLabel } = require("../robloxUserInfo");

// --- Discord native timestamp helpers ----------------------------------------
// https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
//   F = full date+time, R = relative (e.g. "in 3 days")
function _toUnix(d) {
  if (!d) return null;
  const n = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(n) ? Math.floor(n / 1000) : null;
}
function discordTimestamp(d, style = "F") {
  const u = _toUnix(d);
  return u === null ? null : `<t:${u}:${style}>`;
}
function discordFullAndRelative(d) {
  const u = _toUnix(d);
  return u === null ? null : `<t:${u}:F> (<t:${u}:R>)`;
}

function buildResultEmbed(title, result, fields = [], footerText = "", iconUrl = null, description = null) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(result.success ? 0x00ff00 : 0xff0000)
    .addFields(fields)
    .setTimestamp();

  if (description) embed.setDescription(description);

  const footer = footerText || result.status || (result.success ? "Success" : "Failed");
  embed.setFooter({ text: footer });

  if (iconUrl) embed.setThumbnail(iconUrl);

  return embed;
}

function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setTitle("Error")
    .setColor(0xff0000)
    .setDescription(`Error: ${message}`)
    .setTimestamp();
}

// Use this in command catch blocks - never pass error.message directly to Discord
function buildInternalErrorEmbed(message) {
  return buildErrorEmbed(message || "An unexpected error occurred. Please try again.");
}

// Build an actionable error embed for known Open Cloud HTTP statuses.
// `context` is one of: "ban", "unban", "datastore", "messaging", "general".
function buildHttpErrorEmbed(status, context = "general", { universeId, retryAfterMs } = {}) {
  const SCOPE_HINT = {
    ban: "Your API key needs the **`user-restrictions:write`** scope and must be bound to this universe.",
    unban: "Your API key needs the **`user-restrictions:write`** scope.",
    checkBan: "Your API key needs the **`user-restrictions:read`** scope.",
    datastore: "Your API key needs the **DataStore (read/write)** scope and must be bound to this universe.",
    messaging: "Your API key needs the **`universe.messaging-service:publish`** scope.",
    general: "Your API key may be missing required Open Cloud scopes for this universe.",
  };
  const remediation = SCOPE_HINT[context] || SCOPE_HINT.general;

  let title = "Error";
  let description;
  switch (status) {
    case 401:
      title = "Invalid API Key";
      description = `The Roblox API key was rejected (401 Unauthorized).\n\n**How to fix:**\n• Generate a fresh key at <https://create.roblox.com/dashboard/credentials>\n• ${remediation}\n• Re-run \`/setapikey\` with the new key`;
      break;
    case 403:
      title = "Permission Denied";
      description = `Roblox accepted the key but rejected the action (403 Forbidden).\n\n**How to fix:**\n• ${remediation}\n• Confirm the key's universe binding includes \`${universeId ?? "this universe"}\`\n• Re-issue the key with the missing scopes and run \`/setapikey\``;
      break;
    case 404:
      title = "Not Found";
      description = `Roblox returned 404 - the universe, user, or resource could not be found.\n\n**How to fix:**\n• Double-check the universe ID at <https://create.roblox.com/dashboard/creations>\n• Confirm the user ID, datastore name, and scope are correct`;
      break;
    case 429: {
      title = "Rate Limited";
      const retrySecs = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : null;
      description = retrySecs
        ? `Roblox is rate limiting requests. **Try again in ${retrySecs}s.**`
        : `Roblox is rate limiting requests. Wait a moment and try again.`;
      break;
    }
    case 409:
      title = "Conflict";
      description = "This action conflicts with the current state (e.g. user already has an active ban).";
      break;
    case 500:
    case 502:
    case 503:
      title = "Roblox Service Unavailable";
      description = `Roblox returned ${status}. Their servers are having issues - try again in a minute.`;
      break;
    default:
      description = status
        ? `Request failed with HTTP ${status}.`
        : "An unexpected error occurred. Please try again.";
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0xff0000)
    .setDescription(description)
    .setTimestamp();
}

// Try to extract an HTTP status code out of an Open Cloud result.status string
// (status strings look like "Error: HTTP Error 401" or "Error: Invalid API key").
function extractHttpStatus(result) {
  if (!result || result.success) return null;
  if (typeof result.httpStatus === "number") return result.httpStatus;
  const s = String(result.status || "");
  const m = s.match(/HTTP (?:Error )?(\d{3})/i);
  if (m) return Number(m[1]);
  if (/Invalid API key/i.test(s)) return 401;
  if (/Access denied|permissions/i.test(s)) return 403;
  if (/Not found|not_?found/i.test(s)) return 404;
  if (/Rate limit/i.test(s)) return 429;
  return null;
}

function buildProcessingEmbed(description = "Processing your request. This may take a moment.") {
  return new EmbedBuilder()
    .setTitle("Processing...")
    .setDescription(description)
    .setColor(0x5865f2)
    .setTimestamp();
}

function _userTitle(verb, userId, userInfo) {
  if (userInfo?.displayName || userInfo?.username) {
    const name = userInfo.displayName || userInfo.username;
    return `${verb}: ${name} (${userId})`;
  }
  return `${verb} User: ${userId}`;
}

function _userField(userId, userInfo) {
  return { name: "User", value: formatUserLabel(userId, userInfo), inline: true };
}

// Prefer the user's avatar as the embed thumbnail when available; fall back to the
// universe icon. User-centric embeds should foreground the user.
function _pickThumb(userInfo, universeInfo) {
  return userInfo?.avatarUrl || universeInfo?.icon || null;
}

function buildBanEmbed(result, { userId, universeId, reason, duration, excludeAltAccounts }, universeInfo, userInfo) {
  if (!result.success) {
    const status = extractHttpStatus(result);
    if (status) return buildHttpErrorEmbed(status, "ban", { universeId });
  }
  const fields = [
    _userField(userId, userInfo),
    { name: "Universe ID", value: `\`${universeId}\``, inline: true },
    { name: "Reason", value: reason || "-", inline: true },
    { name: "Duration", value: duration || "permanent", inline: true },
    { name: "Exclude Alts", value: excludeAltAccounts ? "✅ Yes" : "❌ No", inline: true },
  ];
  if (result.success && result.expiresDate) {
    fields.push({ name: "Expires", value: discordFullAndRelative(result.expiresDate) || "Permanent", inline: false });
  }
  return buildResultEmbed(
    _userTitle("Ban", userId, userInfo),
    result,
    fields,
    result.success
      ? result.expiresDate
        ? "Player has been banned"
        : "Player has been banned permanently"
      : result.status,
    _pickThumb(userInfo, universeInfo),
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function buildUnbanEmbed(result, { userId, universeId }, universeInfo, userInfo) {
  if (!result.success) {
    const status = extractHttpStatus(result);
    if (status && status !== 404) return buildHttpErrorEmbed(status, "unban", { universeId });
  }
  return buildResultEmbed(
    _userTitle("Unban", userId, userInfo),
    result,
    [
      _userField(userId, userInfo),
      { name: "Universe ID", value: `\`${universeId}\``, inline: true },
    ],
    result.success ? "Player has been unbanned" : result.status,
    _pickThumb(userInfo, universeInfo),
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function buildCheckBanEmbed(result, { userId, universeId }, universeInfo, userInfo) {
  if (!result.success) {
    const status = extractHttpStatus(result);
    if (status) return buildHttpErrorEmbed(status, "checkBan", { universeId });
  }
  const isActive = result.success && result.active;
  const fields = [
    _userField(userId, userInfo),
    { name: "Universe ID", value: `\`${universeId}\``, inline: true },
    { name: "Status", value: isActive ? "🔴 Banned" : "🟢 Not Banned", inline: true },
  ];
  if (isActive) {
    if (result.reason) fields.push({ name: "Reason", value: result.reason, inline: false });
    fields.push({ name: "Banned At", value: discordFullAndRelative(result.startTime) || "Unknown", inline: true });
    fields.push({ name: "Expires", value: discordFullAndRelative(result.expiresDate) || "Permanent", inline: true });
    fields.push({ name: "Alt Ban", value: result.excludeAltAccounts ? "✅ Yes" : "❌ No", inline: true });
  }

  return buildResultEmbed(
    _userTitle("Ban Status", userId, userInfo),
    { success: true, status: isActive ? "User is currently banned" : "User is not banned" },
    fields,
    undefined,
    _pickThumb(userInfo, universeInfo),
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  ).setColor(isActive ? 0xff0000 : 0x00ff00);
}

// Normalize a /v2/.../user-restrictions ban row into a flat shape we can render
// without re-parsing in the embed builder.
function _normalizeBan(b) {
  const uid = b.user?.replace("users/", "") ?? null;
  const r = b.gameJoinRestriction ?? {};
  const reason = r.displayReason || r.privateReason || "No reason";
  let expiresDate = null;
  if (r.duration && r.startTime) {
    const ms = new Date(r.startTime).getTime() + parseInt(r.duration, 10) * 1000;
    if (Number.isFinite(ms)) expiresDate = new Date(ms);
  }
  const startDate = r.startTime ? new Date(r.startTime) : null;
  return {
    userId: uid,
    reason,
    startDate,
    expiresDate,
    excludeAltAccounts: !!r.excludeAltAccounts,
  };
}

// LEGACY: kept for backwards-compat with NLP listBans flow.
function formatBanEntries(data, page, { universeName } = {}) {
  const bans = data.bans || [];
  if (!bans.length) return "No active bans.";
  const offset = (page - 1) * 10;
  const header = universeName ? `**Experience:** ${universeName}\n\n` : "";
  return header + bans.map((b, i) => {
    const n = _normalizeBan(b);
    const expires = n.expiresDate ? discordTimestamp(n.expiresDate, "R") : "Permanent";
    return `**${offset + i + 1}.** \`${n.userId ?? "?"}\` - ${n.reason}\n> Expires: ${expires}`;
  }).join("\n\n");
}

// Build a structured "Active Bans" embed with one field per banned user using
// native Discord relative timestamps. `userInfoMap` (Map<userIdString,info>)
// provides resolved usernames; missing entries fall back to userId only.
function buildListBansEmbed(data, pageNum, { universeName, iconUrl } = {}, userInfoMap) {
  const bans = (data.bans || []).map(_normalizeBan);
  // Keep title plain - Discord embed titles don't render markdown, so the
  // experience link belongs in the description (matches buildBanEmbed et al.)
  const embed = new EmbedBuilder()
    .setTitle("Active Bans")
    .setColor(bans.length ? 0xff4444 : 0x5865f2)
    .setTimestamp();
  if (iconUrl) embed.setThumbnail(iconUrl);

  const descLines = [];
  if (universeName) descLines.push(`**Experience:** ${universeName}`);
  if (!bans.length) {
    descLines.push("No active bans.");
  } else {
    const offset = (pageNum - 1) * 10;
    descLines.push(`**Showing:** ${offset + 1}-${offset + bans.length}`);
  }
  if (descLines.length) embed.setDescription(descLines.join("\n"));

  if (!bans.length) return { embed, bans };

  const offset = (pageNum - 1) * 10;
  // Discord caps an embed at 25 fields - 10 bans/page leaves room for header.
  bans.forEach((n, i) => {
    const info = userInfoMap?.get(String(n.userId));
    const header = info
      ? `${i + offset + 1}. ${info.displayName || info.username}${info.username && info.username !== info.displayName ? ` (@${info.username})` : ""}`
      : `${i + offset + 1}. User ${n.userId ?? "?"}`;
    const expires = n.expiresDate
      ? `Expires ${discordTimestamp(n.expiresDate, "R")}`
      : "Permanent";
    const banned = n.startDate ? `Banned ${discordTimestamp(n.startDate, "R")}` : "Banned (unknown date)";
    const altLine = n.excludeAltAccounts ? " · alts" : "";
    const reasonLine = String(n.reason).slice(0, 400);
    embed.addFields({
      name: header.slice(0, 256),
      value: `\`${n.userId ?? "?"}\` · ${banned} · ${expires}${altLine}\n> ${reasonLine}`.slice(0, 1024),
      inline: false,
    });
  });

  return { embed, bans };
}

// Format JSON into a code-block string safe for embed fields (≤1024 chars)
function formatJsonValue(data) {
  if (data === null || data === undefined) return "No data";
  const LIMIT = 1024;
  const OPEN = "```json\n";   // 8 chars
  const CLOSE = "\n```";      // 4 chars
  const TAIL = "\n...(truncated)"; // 15 chars
  const pretty = JSON.stringify(data, null, 2);
  if (OPEN.length + pretty.length + CLOSE.length <= LIMIT) {
    return `${OPEN}${pretty}${CLOSE}`;
  }
  const maxContent = LIMIT - OPEN.length - TAIL.length - CLOSE.length; // 997
  return `${OPEN}${pretty.slice(0, maxContent)}${TAIL}${CLOSE}`;
}

function buildShowDataEmbed(result, { key, universeId, datastoreName }, universeInfo) {
  const fields = [
    { name: "Key", value: String(key).substring(0, 1000), inline: true },
    { name: "Datastore", value: String(datastoreName).substring(0, 1000), inline: true },
    { name: "Universe ID", value: `\`${universeId}\``, inline: true },
  ];

  if (result.success) {
    fields.push({ name: "Data Size", value: `${JSON.stringify(result.data ?? "", null, 2).length} bytes`, inline: true });
    fields.push({ name: "Value", value: formatJsonValue(result.data), inline: false });
  }

  return buildResultEmbed(
    "Datastore Entry",
    result,
    fields,
    result.success ? "Datastore Entry Information" : result.status,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function buildSetDataEmbed(result, { key, universeId, datastoreName, rawValue, scope }, universeInfo) {
  return buildResultEmbed(
    "Set Datastore Entry",
    result,
    result.success
      ? [
          { name: "Key", value: key, inline: true },
          { name: "Universe ID", value: `\`${universeId}\``, inline: true },
          { name: "Datastore", value: datastoreName, inline: true },
          { name: "Scope", value: scope || "global", inline: true },
          { name: "Value", value: formatJsonValue(rawValue), inline: false },
        ]
      : [],
    result.success ? "Entry successfully written" : result.status,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function buildUpdateDataEmbed(result, { key, universeId, datastoreName, summary, scope }, universeInfo) {
  let fields = [];
  if (result.success) {
    // Treat summary as untrusted (LLM output influenced by datastore content)
    const safeSummary = String(summary).replace(/[\x00-\x1F<>]/g, "").slice(0, 1024) || "No summary";
    fields.push(
      { name: "Key", value: key, inline: true },
      { name: "Universe ID", value: `\`${universeId}\``, inline: true },
      { name: "Datastore", value: datastoreName, inline: true },
      { name: "Scope", value: scope || "global", inline: true },
      { name: "Summary", value: safeSummary, inline: false },
    );
  }

  return buildResultEmbed(
    "Update Datastore Field",
    result,
    fields,
    result.success ? "Field successfully updated" : result.status,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function buildDeleteDataEmbed(result, { key, universeId, datastoreName, scope }, universeInfo) {
  return buildResultEmbed(
    "Delete Datastore Entry",
    result,
    result.success
      ? [
          { name: "Key", value: key, inline: true },
          { name: "Universe ID", value: `\`${universeId}\``, inline: true },
          { name: "Datastore", value: datastoreName, inline: true },
          { name: "Scope", value: scope || "global", inline: true },
        ]
      : [],
    result.success ? "Entry permanently deleted" : result.status,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  ).setColor(result.success ? 0xff6600 : 0xff0000);
}

function formatLeaderboardEntries(data, pageNum, { universeId, scope, universeName, entriesPerPage = 10 }) {
  const offset = (pageNum - 1) * entriesPerPage;
  const entries = data.entries || [];
  const lines = entries
    .map((e, i) => `${offset + i + 1}. **${e.id}** - ${e.value}`)
    .join("\n");
  const headerParts = [];
  if (universeName) headerParts.push(`**Experience:** ${universeName}`);
  headerParts.push(`**Universe:** \`${universeId}\` · **Scope:** \`${scope}\``);
  if (entries.length) headerParts.push(`**Showing:** ${offset + 1}-${offset + entries.length}`);
  return `${headerParts.join("\n")}\n\n${lines || "No entries found."}`;
}

function buildRemoveFromBoardEmbed(result, { userId, universeId, leaderboardName, key }, universeInfo, userInfo) {
  return buildResultEmbed(
    _userTitle("Remove Leaderboard Entry", userId, userInfo),
    result,
    [
      _userField(userId, userInfo),
      { name: "Universe ID", value: `\`${universeId}\``, inline: true },
      { name: "Leaderboard", value: leaderboardName, inline: true },
      { name: "Key", value: key || `\`${userId}\``, inline: true },
    ],
    result.success ? `Entry successfully removed for user \`${userId}\`` : result.status,
    _pickThumb(userInfo, universeInfo),
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function formatKeyEntries(data, _pageNum, { universeId, scope, universeName }) {
  const keys = data.keys || [];
  if (!keys.length) return "No keys found.";
  const header = universeName
    ? `**Experience:** ${universeName} | Universe: \`${universeId}\` | Scope: \`${scope}\``
    : `Universe: \`${universeId}\` | Scope: \`${scope}\``;
  return `${header}\n\n${keys.map(k => `\`${k}\``).join("\n")}`;
}

// Build a structured "Keys" embed showing visible range + hint about more pages.
function buildListKeysEmbed(data, pageNum, { universeId, scope, universeName, datastoreName, iconUrl } = {}) {
  const keys = data.keys || [];
  const offset = (pageNum - 1) * 20;
  const start = keys.length ? offset + 1 : 0;
  const end = offset + keys.length;

  const embed = new EmbedBuilder()
    .setTitle(`Keys - ${datastoreName || "datastore"}`)
    .setColor(0x5865f2)
    .setTimestamp();
  if (iconUrl) embed.setThumbnail(iconUrl);

  const headerLines = [];
  if (universeName) headerLines.push(`**Experience:** ${universeName}`);
  headerLines.push(`**Universe:** \`${universeId}\` · **Scope:** \`${scope}\``);
  headerLines.push(
    keys.length
      ? `**Showing:** ${start}-${end}`
      : "**No keys found in this scope.**"
  );

  let body = headerLines.join("\n");
  if (keys.length) {
    body += "\n\n" + keys.map(k => `• \`${String(k).slice(0, 200)}\``).join("\n");
  }
  // Description cap is 4096 - keys at 200 chars * 20 + overhead is well under.
  embed.setDescription(body.slice(0, 4000));
  return embed;
}

// --- Generic embed builders used across NLP handler, commands, and confirmation flows ---

// Simple status/info embed (replaces local buildEmbed dupes across files)
function buildStatusEmbed(title, description, color = 0xff0000) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

// Confirmation embed with optional experience info and expiry footer
function buildConfirmEmbed(title, description, { iconUrl = null, expirySeconds = 60 } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xffa500)
    .setFooter({ text: `This request expires in ${formatDuration(expirySeconds * 1000)}` })
    .setTimestamp();
  if (iconUrl) embed.setThumbnail(iconUrl);
  return embed;
}

// Data processing consent embed (used in NLP handler consent flow)
function buildConsentEmbed() {
  return new EmbedBuilder()
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
}

module.exports = {
  buildResultEmbed,
  buildErrorEmbed,
  buildInternalErrorEmbed,
  buildHttpErrorEmbed,
  extractHttpStatus,
  buildProcessingEmbed,
  buildStatusEmbed,
  buildConfirmEmbed,
  buildConsentEmbed,
  buildBanEmbed,
  buildUnbanEmbed,
  buildCheckBanEmbed,
  buildListBansEmbed,
  formatBanEntries,
  formatJsonValue,
  buildShowDataEmbed,
  buildSetDataEmbed,
  buildUpdateDataEmbed,
  buildDeleteDataEmbed,
  formatLeaderboardEntries,
  buildRemoveFromBoardEmbed,
  formatKeyEntries,
  buildListKeysEmbed,
  discordTimestamp,
  discordFullAndRelative,
};
