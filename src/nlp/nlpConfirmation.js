// NLP confirmation UI - shows ephemeral confirmation embed with buttons, handles user response

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { executeAction } = require("./nlpExecutor");
const log = require("../utils/logger");
const { buildProcessingEmbed, buildStatusEmbed, buildConfirmEmbed } = require("../utils/formatters");

const BATCH_DELAY_MS = 600; // ms between consecutive Roblox API calls in a batch

/**
 * Show an ephemeral confirmation embed for parsed NLP commands and execute on approval.
 * All responses use the deferred interaction reply (ephemeral).
 *
 * @param {object}   opts
 * @param {Array}    opts.commands        - Parsed command objects from the LLM
 * @param {Map}      opts.universeInfoMap - universeId → { icon, name }
 * @param {object}   opts.interaction     - The modal-submit interaction (already deferred ephemeral)
 * @param {Function} opts.pushHistoryFn   - (channelId, userId, action, params) => void
 */
async function showConfirmationAndExecute({ commands, universeInfoMap, interaction, pushHistoryFn, skipConfirmation = false }) {
  const sendFn = (opts) => interaction.followUp({ ...opts, flags: MessageFlags.Ephemeral });

  // Read-only commands skip the confirmation dialog to reduce latency.
  if (skipConfirmation) {
    try {
      await interaction.editReply({ embeds: [buildProcessingEmbed("Fetching data, please wait…")] });

      const resultEmbeds = [];
      for (const cmd of commands) {
        const universeInfo = universeInfoMap.get(cmd.parameters.universeId) ?? { icon: null, name: null };
        const resultEmbed = await executeAction(cmd.action, cmd.parameters, universeInfo, sendFn, interaction.user.id, interaction.guildId);
        if (resultEmbed) resultEmbeds.push(resultEmbed);
        pushHistoryFn(interaction.channelId, interaction.user.id, cmd.action, cmd.parameters);
        if (commands.length > 1) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }

      if (resultEmbeds.length > 0) {
        const first = resultEmbeds.splice(0, 10);
        await interaction.editReply({ embeds: first });
        while (resultEmbeds.length > 0) {
          await sendFn({ embeds: resultEmbeds.splice(0, 10) });
        }
      } else {
        await interaction.editReply({ embeds: [buildStatusEmbed("Done", "Command completed.", 0x00ff00)] });
      }
    } catch (err) {
      log.error("Error executing read-only command:", err.message);
      await interaction.editReply({
        embeds: [buildStatusEmbed("Execution Error", "Something went wrong while executing the command. Please try again.")],
      }).catch(() => {});
    }
    return;
  }

  const primaryInfo = universeInfoMap.values().next().value ?? {};
  const primaryIcon = primaryInfo.icon ?? null;
  const primaryName = primaryInfo.name ?? null;
  const isBatch = commands.length > 1;

  let confirmEmbed;

  if (isBatch) {
    const summary = commands.map((cmd, i) => `**${i + 1}.** ${cmd.confirmation_summary}`).join("\n");
    const distinctActions = [...new Set(commands.map(c => c.action))];
    const actionLabel = distinctActions.length === 1
      ? `${commands.length} ${distinctActions[0]}`
      : `${commands.length} commands (${distinctActions.join(", ")})`;
    const batchDesc = primaryName ? `**Experience:** ${primaryName}\n\n${summary}` : summary;
    confirmEmbed = buildConfirmEmbed(`Confirm Batch: ${actionLabel}`, batchDesc, { iconUrl: primaryIcon });
  } else {
    const singleDesc = primaryName
      ? `**Experience:** ${primaryName}\n\n${commands[0].confirmation_summary}`
      : commands[0].confirmation_summary;
    confirmEmbed = buildConfirmEmbed(`Confirm: ${commands[0].action}`, singleDesc, { iconUrl: primaryIcon });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("nlp_confirm")
      .setLabel(isBatch ? `Confirm All (${commands.length})` : "Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("nlp_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
  const reply = await interaction.fetchReply();

  const collector = reply.createMessageComponentCollector({ time: 60_000 });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: "Only the person who issued this command can confirm it.", flags: MessageFlags.Ephemeral });
      return;
    }

    collector.stop("handled");

    if (i.customId === "nlp_cancel") {
      await i.update({ content: "Cancelled.", embeds: [], components: [] });
      return;
    }

    // Confirm - execute all commands
    try {
      const processingDesc = isBatch
        ? `Executing ${commands.length} commands…`
        : "Executing command…";
      const processingEmbed = EmbedBuilder.from(i.message.embeds[0])
        .setTitle("Processing...")
        .setDescription(processingDesc)
        .setColor(0x5865f2)
        .setFooter(null);
      await i.update({ embeds: [processingEmbed], components: [] });

      const resultEmbeds = [];
      for (const cmd of commands) {
        const universeInfo = universeInfoMap.get(cmd.parameters.universeId) ?? { icon: null, name: null };
        const resultEmbed = await executeAction(cmd.action, cmd.parameters, universeInfo, sendFn, interaction.user.id, interaction.guildId);
        if (resultEmbed) resultEmbeds.push(resultEmbed);
        pushHistoryFn(interaction.channelId, interaction.user.id, cmd.action, cmd.parameters);
        if (commands.length > 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      if (resultEmbeds.length > 0) {
        const first = resultEmbeds.splice(0, 10);
        await interaction.editReply({ embeds: first, components: [] });
        while (resultEmbeds.length > 0) {
          await sendFn({ embeds: resultEmbeds.splice(0, 10) });
        }
      } else {
        await interaction.editReply({ embeds: [buildStatusEmbed("Done", "Command completed.", 0x00ff00)], components: [] });
      }
    } catch (err) {
      log.error("Error executing confirmed command:", err.message);
      await interaction.editReply({
        embeds: [buildStatusEmbed("Execution Error", "Something went wrong while executing the command. Please try again.")],
        components: [],
      }).catch(() => {});
    }
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      interaction.editReply({ components: [] }).catch(() => {});
    }
  });
}

module.exports = { showConfirmationAndExecute };
