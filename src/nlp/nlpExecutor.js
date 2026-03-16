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

// Recursively collect the names of all leaf keys that differ between two objects.
// Arrays are treated as opaque values (compared by JSON string) so only plain
// object nesting is traversed. Returns null if nesting exceeds 10 levels - the
// caller must treat null as "cannot verify" and block the write.
function getChangedLeafKeys(a, b, depth = 0) {
  if (depth > 10) return null;
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changed = new Set();
  for (const k of keys) {
    const aVal = a?.[k];
    const bVal = b?.[k];
    if (JSON.stringify(aVal) === JSON.stringify(bVal)) continue;
    const aIsObj = typeof aVal === "object" && aVal !== null && !Array.isArray(aVal);
    const bIsObj = typeof bVal === "object" && bVal !== null && !Array.isArray(bVal);
    if (aIsObj && bIsObj) {
      const nested = getChangedLeafKeys(aVal, bVal, depth + 1);
      if (nested === null) return null;
      for (const nk of nested) changed.add(nk);
    } else {
      changed.add(k);
    }
  }
  return changed;
}

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
            // Strip control chars AND XML tag chars to prevent tag-boundary injection
            // into the <instruction>...</instruction> block sent to the second LLM call.
            const field = String(f.field).replace(/[\r\n\x00-\x1F"\\<>/]/g, " ").trim().slice(0, 200);
            const newValue = String(f.newValue).replace(/[\r\n\x00-\x1F<>/]/g, " ").trim().slice(0, 500);
            return `Set the field "${field}" to ${newValue}`;
          })
          .join(". ");
        const { patched, summary } = await patchDatastoreValue(currentValue, instruction, guildId);
        if (!patched) {
          return buildErrorEmbed(`Could not apply update: ${summary}`);
        }

        // Safety: verify the LLM only modified the fields that were requested.
        // We collect changed leaf-key names recursively so that nested structures
        // (e.g. { Data: { Gold: 50 } }) don't trigger a false positive when only
        // an inner field like "Gold" was altered.
        const expectedFields = new Set(params.fields.map(f => f.field));
        const changedLeafKeys = getChangedLeafKeys(currentValue, patched);
        if (changedLeafKeys === null) {
          log.warn(`updateData safety check: nesting depth exceeded for key "${params.key}" - write blocked`);
          return buildErrorEmbed("Cannot verify this update - the datastore entry is too deeply nested to safely check. No changes were written.");
        }
        for (const k of changedLeafKeys) {
          if (!expectedFields.has(k)) {
            return buildErrorEmbed(`Safety check failed: the AI unexpectedly modified field \`${k}\` which was not part of your request. No changes were written. Try rephrasing your instruction to be more specific.`);
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
    const detail = err.response?.data?.message || err.response?.data || err.message;
    log.error(`executeAction error (${action}): ${detail}`, err.response?.status ?? "");
    return buildErrorEmbed(`Error executing \`${action}\`: ${String(detail).slice(0, 500)}`);
  }
}

module.exports = { executeAction };
