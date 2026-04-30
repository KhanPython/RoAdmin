// Paginated embed list with button navigation

"use strict";

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const log = require("./logger");
const { formatDuration } = require("./timeFormat");

/**
 * Send a paginated message.
 *
 * Required:
 *   - authorId, fetchPage(pageToken) -> {success, status, ...data, nextPageToken}
 *   - sendInitial(opts) -> Message
 *   - title  (used by default embed builder)
 *
 * Embed source - choose ONE:
 *   - formatEntries(data, pageNum) -> string  (legacy: rendered into description)
 *   - buildEmbed(data, pageNum, ctx) -> EmbedBuilder | { embed, postProcess? }
 *
 * Optional UI extensions:
 *   - buildExtraRows(data, pageNum) -> ActionRow[]   extra component rows merged
 *                                                    above the nav buttons
 *   - onComponent({ interaction, data, refresh })    handles non-`pg_*` button
 *                                                    or select clicks
 *
 * Optional behaviour:
 *   - timeoutMs   default 120s. On expiry, buttons are disabled in-place rather
 *                 than the message being deleted.
 *   - iconUrl     thumbnail when using the default embed builder
 */
async function sendPaginatedList({
  authorId,
  title,
  iconUrl,
  fetchPage,
  formatEntries,
  buildEmbed,
  buildExtraRows,
  onComponent,
  sendInitial,
  editFn = null,
  deleteFn = null, // unused now; kept for backwards-compat callers
  timeoutMs = 120_000,
}) {
  void deleteFn;
  const pageTokens = [null];
  let currentPage = 0;
  let lastData = null;

  const expiryLabel = formatDuration(timeoutMs);

  const _navRow = (hasPrev, hasNext) => {
    const buttons = [
      new ButtonBuilder().setCustomId("pg_first").setLabel("⏮ First").setStyle(ButtonStyle.Primary).setDisabled(!hasPrev),
      new ButtonBuilder().setCustomId("pg_prev").setLabel("◀ Prev").setStyle(ButtonStyle.Primary).setDisabled(!hasPrev),
      new ButtonBuilder().setCustomId("pg_next").setLabel("Next ▶").setStyle(ButtonStyle.Primary).setDisabled(!hasNext),
    ];
    return new ActionRowBuilder().addComponents(...buttons);
  };

  const buildPage = async () => {
    const data = await fetchPage(pageTokens[currentPage]);

    if (!data.success) {
      return {
        embed: new EmbedBuilder()
          .setTitle("Error")
          .setColor(0xff0000)
          .setDescription(data.status || "Failed to fetch data")
          .setTimestamp(),
        components: [],
        ok: false,
        data,
      };
    }

    if (data.nextPageToken && currentPage + 1 >= pageTokens.length) {
      pageTokens.push(data.nextPageToken);
    }

    const hasNext = currentPage + 1 < pageTokens.length;
    const hasPrev = currentPage > 0;
    const isMultiPage = hasPrev || hasNext;

    const footerText = isMultiPage
      ? `Page ${currentPage + 1} · Expires in ${expiryLabel}`
      : `Page ${currentPage + 1}`;

    let embed;
    if (buildEmbed) {
      const out = buildEmbed(data, currentPage + 1, { hasNext, hasPrev });
      embed = out instanceof EmbedBuilder ? out : out?.embed;
    } else {
      embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x5865f2)
        .setDescription(formatEntries(data, currentPage + 1) || "No entries found.")
        .setTimestamp();
      if (iconUrl) embed.setThumbnail(iconUrl);
    }
    if (embed) embed.setFooter({ text: footerText });

    const rows = [];
    if (buildExtraRows) {
      const extra = buildExtraRows(data, currentPage + 1) || [];
      for (const r of extra) if (r) rows.push(r);
    }
    if (isMultiPage) rows.push(_navRow(hasPrev, hasNext));

    return { embed, components: rows, ok: true, data };
  };

  const initial = await buildPage();
  lastData = initial.data;
  let lastEmbed = initial.embed;
  let lastComponents = initial.components;
  const msg = await sendInitial({ embeds: [initial.embed], components: initial.components });

  // No interactive components — nothing to collect.
  if (!initial.ok || initial.components.length === 0) return;

  const doEdit = editFn ?? ((opts) => msg.edit(opts));

  // Track latest interaction to scope the disable-on-expire edit correctly for
  // ephemeral messages (whose only valid token belongs to the most-recent
  // interaction).
  let latestInteraction = null;

  const collector = msg.createMessageComponentCollector({
    filter: (i) => i.user.id === authorId,
    time: timeoutMs,
  });

  const refresh = async (i) => {
    latestInteraction = i;
    const { embed, components, data } = await buildPage();
    lastData = data;
    lastEmbed = embed;
    lastComponents = components;
    if (i && !i.replied && !i.deferred) await i.deferUpdate().catch(() => {});
    if (i) {
      await i.editReply({ embeds: [embed], components }).catch(async () => {
        await doEdit({ embeds: [embed], components }).catch(() => {});
      });
    } else {
      await doEdit({ embeds: [embed], components }).catch(() => {});
    }
  };

  collector.on("collect", async (i) => {
    try {
      if (i.customId === "pg_first") { currentPage = 0; await refresh(i); return; }
      if (i.customId === "pg_prev")  { currentPage = Math.max(0, currentPage - 1); await refresh(i); return; }
      if (i.customId === "pg_next")  { currentPage++; await refresh(i); return; }

      if (onComponent) {
        await onComponent({
          interaction: i,
          data: lastData,
          refresh: () => refresh(i),
        });
      }
    } catch (err) {
      log.warn("Pagination collect handler error:", err.message);
    }
  });

  collector.on("end", async () => {
    // Disable all components in-place rather than deleting the message - leaves
    // a clear "expired" state instead of vanishing without explanation.
    try {
      const disabledRows = (lastComponents || []).map(r => {
        const cloned = ActionRowBuilder.from(r);
        cloned.components.forEach(c => c.setDisabled?.(true));
        return cloned;
      });
      const expiredEmbed = lastEmbed
        ? EmbedBuilder.from(lastEmbed).setFooter({
            text: (lastEmbed.data?.footer?.text || "").replace(/ · Expires in.*/, "") + " · Expired",
          })
        : null;
      const target = latestInteraction
        ? (opts) => latestInteraction.editReply(opts)
        : doEdit;
      await target({
        embeds: expiredEmbed ? [expiredEmbed] : (lastEmbed ? [lastEmbed] : []),
        components: disabledRows,
      }).catch(() => {});
    } catch (err) {
      log.debug("Pagination expire handler failed:", err.message);
    }
  });
}

module.exports = { sendPaginatedList };
