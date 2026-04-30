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

async function sendPaginatedList({
  authorId,
  title,
  iconUrl,
  fetchPage,
  formatEntries,
  sendInitial,
  editFn = null,
  deleteFn = null,
  timeoutMs = 120_000,
}) {
  const pageTokens = [null]; // pageTokens[i] = cursor for page i; null = first page
  let currentPage = 0;

  const expiryLabel = formatDuration(timeoutMs);

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
      };
    }

    // Cache next-page cursor the first time we discover it
    if (data.nextPageToken && currentPage + 1 >= pageTokens.length) {
      pageTokens.push(data.nextPageToken);
    }

    const hasNext = currentPage + 1 < pageTokens.length;
    const hasPrev = currentPage > 0;
    const isMultiPage = hasPrev || hasNext;

    const footerText = isMultiPage
      ? `Page ${currentPage + 1} · Expires in ${expiryLabel}`
      : `Page ${currentPage + 1}`;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x5865f2)
      .setDescription(formatEntries(data, currentPage + 1) || "No entries found.")
      .setFooter({ text: footerText })
      .setTimestamp();
    if (iconUrl) embed.setThumbnail(iconUrl);

    const buttons = isMultiPage
      ? [
          new ButtonBuilder().setCustomId("pg_first").setLabel("⏮ First").setStyle(ButtonStyle.Primary).setDisabled(!hasPrev),
          new ButtonBuilder().setCustomId("pg_prev").setLabel("◀ Prev").setStyle(ButtonStyle.Primary).setDisabled(!hasPrev),
          new ButtonBuilder().setCustomId("pg_next").setLabel("Next ▶").setStyle(ButtonStyle.Primary).setDisabled(!hasNext),
        ]
      : [];

    const components = buttons.length > 0
      ? [new ActionRowBuilder().addComponents(...buttons)]
      : [];

    return { embed, components, ok: true };
  };

  const initial = await buildPage();
  const msg = await sendInitial({ embeds: [initial.embed], components: initial.components });

  // Nothing to paginate, or first fetch failed - no collector needed
  if (!initial.ok || initial.components.length === 0) return;

  const doEdit = editFn ?? ((opts) => msg.edit(opts));

  let latestInteraction = null;

  const collector = msg.createMessageComponentCollector({
    filter: (i) => i.user.id === authorId,
    time: timeoutMs,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "pg_first") currentPage = 0;
    else if (i.customId === "pg_prev") currentPage = Math.max(0, currentPage - 1);
    else currentPage++; // pg_next

    try {
      await i.deferUpdate();
      latestInteraction = i;
      const { embed, components } = await buildPage();
      await i.editReply({ embeds: [embed], components });
    } catch (err) {
      log.warn("Pagination collect handler error:", err.message);
    }
  });

  collector.on("end", async () => {
    try {
      if (latestInteraction) {
        // Most recent button interaction owns the (often ephemeral) message token.
        await latestInteraction.deleteReply();
      } else if (deleteFn) {
        await deleteFn();
      } else {
        await msg.delete();
      }
    } catch (err) {
      log.debug("Pagination cleanup delete failed:", err.message);
    }
  });
}

module.exports = { sendPaginatedList };
