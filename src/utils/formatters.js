// Discord embed builders for all command result types

"use strict";

const { EmbedBuilder } = require("discord.js");

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

function buildProcessingEmbed(description = "Processing your request. This may take a moment.") {
  return new EmbedBuilder()
    .setTitle("Processing...")
    .setDescription(description)
    .setColor(0x5865f2)
    .setTimestamp();
}

function buildBanEmbed(result, { userId, universeId, reason, duration, excludeAltAccounts }, universeInfo) {
  return buildResultEmbed(
    `Ban User: \`${userId}\``,
    result,
    [
      { name: "User ID", value: `\`${userId}\``, inline: true },
      { name: "Universe ID", value: `\`${universeId}\``, inline: true },
      { name: "Reason", value: reason, inline: true },
      { name: "Duration", value: duration || "permanent", inline: true },
      { name: "Exclude Alts", value: excludeAltAccounts ? "✅ Yes" : "❌ No", inline: true },
    ],
    result.success
      ? result.expiresDate
        ? `Player has been banned until ${result.expiresDate.toLocaleString()}`
        : "Player has been banned permanently"
      : result.status,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function buildUnbanEmbed(result, { userId, universeId }, universeInfo) {
  return buildResultEmbed(
    `Unban User: \`${userId}\``,
    result,
    [
      { name: "User ID", value: `\`${userId}\``, inline: true },
      { name: "Universe ID", value: `\`${universeId}\``, inline: true },
    ],
    result.success ? "Player has been unbanned" : result.status,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function buildCheckBanEmbed(result, { userId, universeId }, universeInfo) {
  const isActive = result.success && result.active;
  const fields = [
    { name: "User ID", value: `\`${userId}\``, inline: true },
    { name: "Universe ID", value: `\`${universeId}\``, inline: true },
    { name: "Status", value: isActive ? "🔴 Banned" : "🟢 Not Banned", inline: true },
  ];
  if (isActive) {
    if (result.reason) fields.push({ name: "Reason", value: result.reason, inline: false });
    fields.push({ name: "Banned At", value: result.startTime ? result.startTime.toLocaleString() : "Unknown", inline: true });
    fields.push({ name: "Expires", value: result.expiresDate ? result.expiresDate.toLocaleString() : "Permanent", inline: true });
    fields.push({ name: "Alt Ban", value: result.excludeAltAccounts ? "✅ Yes" : "❌ No", inline: true });
  }

  return buildResultEmbed(
    `Ban Status: User \`${userId}\``,
    { success: true, status: isActive ? "User is currently banned" : "User is not banned" },
    fields,
    undefined,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  ).setColor(isActive ? 0xff0000 : 0x00ff00);
}

function formatBanEntries(data, page) {
  const bans = data.bans || [];
  if (!bans.length) return "No active bans.";
  const offset = (page - 1) * 10;
  return bans.map((b, i) => {
    const uid = b.user?.replace("users/", "") ?? "?";
    const r = b.gameJoinRestriction ?? {};
    const reason = r.displayReason || r.privateReason || "No reason";
    let expires = "Permanent";
    if (r.duration && r.startTime) {
      const expDt = new Date(new Date(r.startTime).getTime() + parseInt(r.duration, 10) * 1000);
      expires = expDt.toLocaleDateString();
    }
    return `**${offset + i + 1}.** \`${uid}\` - ${reason}\n> Expires: ${expires}`;
  }).join("\n\n");
}

// Format JSON into a code-block string safe for embed fields (≤1024 chars)
function formatJsonValue(data) {
  if (data === null || data === undefined) return "No data";
  const pretty = JSON.stringify(data, null, 2);
  const block = `\`\`\`json\n${pretty}\n\`\`\``;
  if (block.length <= 1024) return block;
  return `\`\`\`json\n${pretty.slice(0, 990)}\n...(truncated)\`\`\``;
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
    fields.push(
      { name: "Key", value: key, inline: true },
      { name: "Universe ID", value: `\`${universeId}\``, inline: true },
      { name: "Datastore", value: datastoreName, inline: true },
      { name: "Scope", value: scope || "global", inline: true },
      { name: "Summary", value: summary, inline: false },
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
  const lines = (data.entries || [])
    .map((e, i) => `${offset + i + 1}. **${e.id}** - ${e.value}`)
    .join("\n");
  const header = universeName
    ? `**Experience:** ${universeName} | Universe: \`${universeId}\` | Scope: \`${scope}\``
    : `Universe: \`${universeId}\` | Scope: \`${scope}\``;
  return `${header}\n\n${lines || "No entries found."}`;
}

function buildRemoveFromBoardEmbed(result, { userId, universeId, leaderboardName, key }, universeInfo) {
  return buildResultEmbed(
    "Remove Leaderboard Entry",
    result,
    [
      { name: "User ID", value: `\`${userId}\``, inline: true },
      { name: "Universe ID", value: `\`${universeId}\``, inline: true },
      { name: "Leaderboard", value: leaderboardName, inline: true },
      { name: "Key", value: key || `\`${userId}\``, inline: true },
    ],
    result.success ? `Entry successfully removed for user \`${userId}\`` : result.status,
    universeInfo?.icon ?? null,
    universeInfo?.name ? `**Experience:** ${universeInfo.name}` : null,
  );
}

function formatKeyEntries(data, _pageNum, { universeId, scope }) {
  const keys = data.keys || [];
  if (!keys.length) return "No keys found.";
  const header = `Universe: \`${universeId}\` | Scope: \`${scope}\`\n\n`;
  return header + keys.map(k => `\`${k}\``).join("\n");
}

module.exports = {
  buildResultEmbed,
  buildErrorEmbed,
  buildProcessingEmbed,
  buildBanEmbed,
  buildUnbanEmbed,
  buildCheckBanEmbed,
  formatBanEntries,
  formatJsonValue,
  buildShowDataEmbed,
  buildSetDataEmbed,
  buildUpdateDataEmbed,
  buildDeleteDataEmbed,
  formatLeaderboardEntries,
  buildRemoveFromBoardEmbed,
  formatKeyEntries,
};
