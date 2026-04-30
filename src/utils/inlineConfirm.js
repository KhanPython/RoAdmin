// Inline ephemeral confirmation prompt for destructive actions triggered from
// component interactions (e.g. select menus inside paginated lists).
//
// Returns true if the user clicked Confirm, false otherwise (cancelled or timed out).

"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { buildConfirmEmbed } = require("./formatters");
const log = require("./logger");

/**
 * Prompt the user to confirm an action via an ephemeral embed with Confirm/Cancel buttons.
 * The select-menu (or button) interaction must NOT be deferred or replied to before calling.
 *
 * @param {object} opts
 * @param {import("discord.js").MessageComponentInteraction} opts.interaction
 * @param {string} opts.title         - Confirmation title (e.g. "Confirm Unban")
 * @param {string} opts.description   - Body text shown above the buttons
 * @param {string|null} [opts.iconUrl]
 * @param {number} [opts.timeoutMs=30000]
 * @returns {Promise<boolean>}
 */
async function promptInlineConfirm({ interaction, title, description, iconUrl = null, timeoutMs = 30_000 }) {
  const embed = buildConfirmEmbed(title, description, {
    iconUrl,
    expirySeconds: Math.round(timeoutMs / 1000),
  });

  const confirmId = `ic_confirm_${interaction.id}`;
  const cancelId = `ic_cancel_${interaction.id}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel("Confirm").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Danger),
  );

  const reply = await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  });

  try {
    const click = await reply.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
      time: timeoutMs,
    });

    if (click.customId === cancelId) {
      // Drop the prompt entirely - no need to leave a "Cancelled" residue.
      await click.deferUpdate().catch(() => {});
      await interaction.deleteReply().catch(() => {});
      return false;
    }

    await click.update({
      embeds: [embed.setDescription(`${description}\n\n✅ Confirmed`)],
      components: [],
    }).catch(() => {});
    return true;
  } catch (err) {
    log.debug("Inline confirm timed out or errored:", err.message);
    await interaction.editReply({
      embeds: [embed.setDescription(`${description}\n\n⏱ Confirmation timed out.`)],
      components: [],
    }).catch(() => {});
    return false;
  }
}

module.exports = { promptInlineConfirm };
