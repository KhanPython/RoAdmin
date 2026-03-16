// NLP action executor - translates parsed NLP commands into Roblox Open Cloud API calls

const { AttachmentBuilder } = require("discord.js");
const openCloud = require("../openCloudAPI");
const log = require("../utils/logger");
const { patchDatastoreValue } = require("./llmProcessor");
const { sendPaginatedList } = require("../utils/pagination");
const {
  buildBanEmbed,
  buildUnbanEmbed,
  buildCheckBanEmbed,
  formatBanEntries,
  buildShowDataEmbed,
  buildSetDataEmbed,
  buildUpdateDataEmbed,
  formatLeaderboardEntries,
  buildRemoveFromBoardEmbed,
  formatKeyEntries,
  buildErrorEmbed,
  buildInternalErrorEmbed,
} = require("../utils/formatters");
const { scheduleAutoDelete } = require("../utils/autoDelete");

// Execute a parsed action and return a result embed (null for paginated actions)
async function executeAction(action, params, universeInfo, channel, authorId, guildId) {
  try {
    let result;
    const iconUrl = universeInfo?.icon ?? null;

    switch (action) {
      case "ban":
        result = await openCloud.BanUser(
          guildId,
          params.userId,
          params.reason,
          params.duration || null,
          params.excludeAlts || false,
          params.universeId,
          authorId
        );
        return buildBanEmbed(result, {
          userId: params.userId,
          universeId: params.universeId,
          reason: params.reason,
          duration: params.duration,
          excludeAltAccounts: params.excludeAlts || false,
        }, universeInfo);

      case "unban":
        result = await openCloud.UnbanUser(guildId, params.userId, params.universeId);
        return buildUnbanEmbed(result, { userId: params.userId, universeId: params.universeId }, universeInfo);

      case "showData": {
        result = await openCloud.GetDataStoreEntry(
          guildId,
          params.key,
          params.universeId,
          params.datastoreName
        );
        const showEmbed = buildShowDataEmbed(result, { key: params.key, universeId: params.universeId, datastoreName: params.datastoreName }, universeInfo);
        if (result.success && result.data !== null && result.data !== undefined) {
          showEmbed.setFooter({ text: "This message will be auto-deleted in 2 minutes" });
          const jsonString = JSON.stringify(result.data, null, 2);
          const fileBuffer = Buffer.from(jsonString, "utf-8");
          const attachment = new AttachmentBuilder(fileBuffer, { name: `${params.key}_data.txt` });
          const sentMsg = await channel.send({ embeds: [showEmbed], files: [attachment] });
          scheduleAutoDelete(sentMsg);
        } else {
          showEmbed.addFields({ name: "Value", value: "No data found for this key.", inline: false });
          await channel.send({ embeds: [showEmbed] });
        }
        return null;
      }

      case "listLeaderboard": {
        await sendPaginatedList({
          authorId,
          title: `Leaderboard: ${params.leaderboardName}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListOrderedDataStoreEntries(guildId, params.leaderboardName, params.scope || "global", pt, params.universeId, 10),
          formatEntries: (data, pageNum) => formatLeaderboardEntries(data, pageNum, { universeId: params.universeId, scope: params.scope || "global", universeName: universeInfo?.name ?? null }),
          sendInitial: (opts) => channel.send(opts),
        });
        return null;
      }

      case "removeFromBoard":
        result = await openCloud.RemoveOrderedDataStoreData(
          guildId,
          params.userId,
          params.leaderboardName,
          params.key || String(params.userId),
          params.scope || "global",
          params.universeId
        );
        return buildRemoveFromBoardEmbed(result, {
          userId: params.userId,
          universeId: params.universeId,
          leaderboardName: params.leaderboardName,
          key: params.key,
        }, universeInfo);

      case "checkBan":
        result = await openCloud.CheckBanStatus(guildId, params.userId, params.universeId);
        return buildCheckBanEmbed(result, { userId: params.userId, universeId: params.universeId }, universeInfo);

      case "listBans":
        await sendPaginatedList({
          authorId,
          title: `Active Bans - Universe ${params.universeId}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListBans(guildId, params.universeId, pt),
          formatEntries: (data, pageNum) => formatBanEntries(data, pageNum, { universeName: universeInfo?.name ?? null }),
          sendInitial: (opts) => channel.send(opts),
        });
        return null;

      case "setData": {
        let parsedValue = params.value;
        try { parsedValue = JSON.parse(params.value); } catch (_) { /* keep as string */ }
        result = await openCloud.SetDataStoreEntry(
          guildId,
          params.key,
          parsedValue,
          params.universeId,
          params.datastoreName,
          params.scope || "global"
        );
        return buildSetDataEmbed(result, {
          key: params.key,
          universeId: params.universeId,
          datastoreName: params.datastoreName,
          rawValue: params.value,
          scope: params.scope || "global",
        }, universeInfo);
      }

      case "updateData": {
        // 1. Fetch the current value once (works for both single and merged multi-field updates)
        const fetchResult = await openCloud.GetDataStoreEntry(
          guildId,
          params.key,
          params.universeId,
          params.datastoreName
        );
        if (!fetchResult.success || fetchResult.data === null || fetchResult.data === undefined) {
          return buildErrorEmbed(`Could not fetch current data for key \"${params.key}\" - ${fetchResult.status || "entry not found"}.`);
        }

        const currentValue = fetchResult.data;
        if (typeof currentValue !== "object" || currentValue === null) {
          return buildErrorEmbed(`The value for key \"${params.key}\" is not a JSON object (it's a ${typeof currentValue}). Use \`setData\` to replace it entirely.`);
        }

        // 2. Build one combined instruction covering all field changes, then patch in a single LLM call.
        // Sanitize field names and values to strip control characters before they reach the next LLM call.
        const instruction = params.fields
          .map(f => {
            const field = String(f.field).replace(/[\r\n\x00-\x1F"\\]/g, " ").trim().slice(0, 200);
            const newValue = String(f.newValue).replace(/[\r\n\x00-\x1F]/g, " ").trim().slice(0, 500);
            return `Set the field "${field}" to ${newValue}`;
          })
          .join(". ");
        const { patched, summary } = await patchDatastoreValue(currentValue, instruction, guildId);
        if (!patched) {
          return buildErrorEmbed(`Could not apply update: ${summary}`);
        }

        // Safety: verify the LLM only modified the fields that were requested
        const expectedFields = new Set(params.fields.map(f => f.field));
        const allKeys = new Set([...Object.keys(currentValue), ...Object.keys(patched)]);
        for (const k of allKeys) {
          if (!expectedFields.has(k) && JSON.stringify(currentValue[k]) !== JSON.stringify(patched[k])) {
            log.warn(`updateData safety check: LLM modified unexpected field "${k}" for key "${params.key}"`);
            return buildInternalErrorEmbed();
          }
        }

        // 3. Single write back regardless of how many fields changed
        result = await openCloud.SetDataStoreEntry(
          guildId,
          params.key,
          patched,
          params.universeId,
          params.datastoreName,
          params.scope || "global"
        );

        return buildUpdateDataEmbed(result, {
          key: params.key,
          universeId: params.universeId,
          datastoreName: params.datastoreName,
          summary,
          scope: params.scope || "global",
        }, universeInfo);
      }

      case "listKeys":
        await sendPaginatedList({
          authorId,
          title: `Keys - ${params.datastoreName}`,
          iconUrl,
          fetchPage: (pt) => openCloud.ListDataStoreKeys(guildId, params.universeId, params.datastoreName, params.scope || "global", pt),
          formatEntries: (data, pageNum) => formatKeyEntries(data, pageNum, { universeId: params.universeId, scope: params.scope || "global", universeName: universeInfo?.name ?? null }),
          sendInitial: (opts) => channel.send(opts),
        });
        return null;

      default:
        return buildErrorEmbed(`Action "${action}" is not recognised.`);
    }
  } catch (err) {
    log.error(`executeAction error (${action}):`, err.message);
    return buildErrorEmbed("Something went wrong while executing the command. Please try again.");
  }
}

module.exports = { executeAction };
