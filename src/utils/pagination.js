"use strict";

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

/**
 * Display a paginated list with ⏮ First / ◀ Prev / Next ▶ navigation.
 * Works for both channel messages (NLP) and interaction replies (slash commands).
 *
 * @param {object}   opts
 * @param {string}   opts.authorId        Discord user ID allowed to navigate
 * @param {string}   opts.title           Embed title
 * @param {string|null} opts.iconUrl      Optional thumbnail URL
 * @param {function(string|null): Promise<object>} opts.fetchPage
 *   Called with the page cursor (null = first page).
 *   Must return an object with { success, nextPageToken?, ... }.
 * @param {function(object, number): string} opts.formatEntries
 *   Called with (apiResult, 1-based page number). Returns embed description text.
 * @param {function(object): Promise<import('discord.js').Message>} opts.sendInitial
 *   Called with { embeds, components }. Must return a Message object.
 *   For slash commands: `(opts) => interaction.editReply(opts)` (after deferReply).
 *   For NLP / channel: `(opts) => channel.send(opts)`.
 * @param {function(object): Promise<any>} [opts.editFn]
 *   Optional override for editing the message on navigation.
 *   Required for ephemeral slash command messages (pass `interaction.editReply`).
 *   Defaults to `msg.edit`.
 * @param {number}   [opts.timeoutMs=120000]
 */
async function sendPaginatedList({
  authorId,
  title,
  iconUrl,
  fetchPage,
  formatEntries,
  sendInitial,
  editFn = null,
  timeoutMs = 120_000,
}) {
  const pageTokens = [null]; // pageTokens[i] = cursor for page i; null = first page
  let currentPage = 0;

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

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x5865f2)
      .setDescription(formatEntries(data, currentPage + 1) || "No entries found.")
      .setFooter({ text: `Page ${currentPage + 1}` })
      .setTimestamp();
    if (iconUrl) embed.setThumbnail(iconUrl);

    const isMultiPage = hasPrev || hasNext;

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

  const collector = msg.createMessageComponentCollector({
    filter: (i) => i.user.id === authorId,
    time: timeoutMs,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "pg_first") currentPage = 0;
    else if (i.customId === "pg_prev") currentPage = Math.max(0, currentPage - 1);
    else currentPage++; // pg_next

    await i.deferUpdate();
    const { embed, components } = await buildPage();
    await doEdit({ embeds: [embed], components }).catch(() => {});
  });

  collector.on("end", () => {
    doEdit({ components: [] }).catch(() => {});
  });
}

module.exports = { sendPaginatedList };
