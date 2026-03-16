// NLP confirmation UI - shows confirmation embed with buttons, handles user response

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { executeAction } = require("./nlpExecutor");
const log = require("../utils/logger");

const BATCH_DELAY_MS = 600; // ms between consecutive Roblox API calls in a batch

function buildEmbed(title, description, color = 0xff0000) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

/**
 * Show a confirmation embed for parsed NLP commands and execute on approval.
 * @param {object}   opts
 * @param {Array}    opts.commands        - Parsed command objects from the LLM
 * @param {Map}      opts.universeInfoMap - universeId → { icon, name }
 * @param {object}   opts.message         - The original Discord message
 * @param {object}   opts.thinkingReply   - The bot's "thinking" reply to edit
 * @param {Function} opts.pushHistoryFn   - (channelId, userId, action, params) => void
 */
async function showConfirmationAndExecute({ commands, universeInfoMap, message, thinkingReply, pushHistoryFn, skipConfirmation = false }) {
  // Read-only commands skip the confirmation dialog to reduce latency.
  if (skipConfirmation) {
    try {
      const processingEmbed = new EmbedBuilder()
        .setTitle("Processing…")
        .setDescription("Fetching data, please wait…")
        .setColor(0x5865f2)
        .setTimestamp();
      await thinkingReply.edit({ embeds: [processingEmbed], components: [] });

      const resultEmbeds = [];
      for (const cmd of commands) {
        const universeInfo = universeInfoMap.get(cmd.parameters.universeId) ?? { icon: null, name: null };
        const resultEmbed = await executeAction(cmd.action, cmd.parameters, universeInfo, message.channel, message.author.id, message.guildId);
        if (resultEmbed) resultEmbeds.push(resultEmbed);
        pushHistoryFn(message.channel.id, message.author.id, cmd.action, cmd.parameters);
        if (commands.length > 1) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }

      await thinkingReply.delete().catch(() => {});
      while (resultEmbeds.length > 0) {
        const batch = resultEmbeds.splice(0, 10);
        await message.channel.send({ embeds: batch });
      }
    } catch (err) {
      log.error("Error executing read-only command:", err.message);
      await message.channel.send({
        embeds: [buildEmbed("Execution Error", "Something went wrong while executing the command. Please try again.")],
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
    confirmEmbed = new EmbedBuilder()
      .setTitle(`Confirm Batch: ${actionLabel}`)
      .setDescription(batchDesc)
      .setColor(0xffa500)
      .setFooter({ text: "This request expires in 60 seconds" })
      .setTimestamp();
  } else {
    const singleDesc = primaryName
      ? `**Experience:** ${primaryName}\n\n${commands[0].confirmation_summary}`
      : commands[0].confirmation_summary;
    confirmEmbed = new EmbedBuilder()
      .setTitle(`Confirm: ${commands[0].action}`)
      .setDescription(singleDesc)
      .setColor(0xffa500)
      .setFooter({ text: "This request expires in 60 seconds" })
      .setTimestamp();
  }

  if (primaryIcon) {
    confirmEmbed.setThumbnail(primaryIcon);
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

  await thinkingReply.edit({ embeds: [confirmEmbed], components: [row] });
  const reply = thinkingReply;

  const collector = reply.createMessageComponentCollector({ time: 60_000 });

  collector.on("collect", async (i) => {
    if (i.user.id !== message.author.id) {
      await i.reply({ content: "Only the person who issued this command can confirm it.", ephemeral: true });
      return;
    }

    collector.stop("handled");

    if (i.customId === "nlp_cancel") {
      await i.deferUpdate();
      await reply.delete().catch(() => {});
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
        const resultEmbed = await executeAction(cmd.action, cmd.parameters, universeInfo, message.channel, message.author.id, message.guildId);
        if (resultEmbed) resultEmbeds.push(resultEmbed);
        pushHistoryFn(message.channel.id, message.author.id, cmd.action, cmd.parameters);
        // Stagger requests to avoid hitting Roblox rate limits on batches
        if (commands.length > 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // Discord allows up to 10 embeds per message - split if needed
      while (resultEmbeds.length > 0) {
        const batch = resultEmbeds.splice(0, 10);
        await message.channel.send({ embeds: batch });
      }

      // Remove the confirmation message now that results are shown
      await reply.delete().catch(() => {});
    } catch (err) {
      log.error("Error executing confirmed command:", err.message);
      await message.channel.send({
        embeds: [buildEmbed("Execution Error", "Something went wrong while executing the command. Please try again.")],
      }).catch(() => {});
    }
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      reply.edit({ components: [] }).catch(() => {});
    }
  });
}

module.exports = { showConfirmationAndExecute };
