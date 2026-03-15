const { ApplicationCommandOptionType, MessageFlags, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { buildDeleteDataEmbed, buildErrorEmbed } = require("../utils/formatters");

module.exports = {
  category: "Player Data",
  description: "Delete a datastore entry by key (irreversible)",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 3,
  expectedArgs: "<key> <universeid> <datastore> [scope]",
  guildOnly: true,

  options: [
    {
      name: "key",
      description: "The datastore entry key to delete",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "datastore",
      description: "The datastore name",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "scope",
      description: "The datastore scope (default: global)",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const key = interaction?.options?.getString("key") || args[0];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);
    const datastoreName = interaction?.options?.getString("datastore") || args[2];
    const scope = interaction?.options?.getString("scope") || args[3] || "global";

    if (!key || key.trim().length === 0) return "Please provide a valid entry key.";
    if (!universeId || isNaN(universeId)) return "Please provide a valid Universe ID.";
    if (!datastoreName || datastoreName.trim().length === 0) return "Please provide a datastore name.";

    await interaction.deferReply();

    try {
      if (!openCloud.hasApiKey(universeId)) {
        await interaction.editReply({ embeds: [apiCache.createMissingApiKeyEmbed(universeId)] });
        return;
      }

      const universeCheck = await universeUtils.verifyUniverseExists(openCloud, universeId);
      if (!universeCheck.success) {
        await interaction.editReply({ content: universeCheck.errorMessage });
        return;
      }
      const universeInfo = universeCheck.universeInfo;

      const experienceHeader = universeInfo?.name ? `**Experience:** ${universeInfo.name}\n\n` : "";
      const warningEmbed = new EmbedBuilder()
        .setTitle("⚠️ Confirm Data Deletion")
        .setDescription(
          `${experienceHeader}**This action is irreversible.** The datastore entry will be permanently deleted from Roblox and cannot be recovered.`
        )
        .addFields(
          { name: "Key", value: key, inline: true },
          { name: "Datastore", value: datastoreName, inline: true },
          { name: "Universe", value: `\`${universeId}\``, inline: true },
          { name: "Scope", value: scope, inline: true },
        )
        .setColor(0xff0000)
        .setFooter({ text: "This confirmation expires in 30 seconds" })
        .setTimestamp();

      if (universeInfo?.icon) warningEmbed.setThumbnail(universeInfo.icon);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("deletedata_confirm")
          .setLabel("Delete Permanently")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("deletedata_cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [warningEmbed], components: [row] });

      const reply = await interaction.fetchReply();
      const collector = reply.createMessageComponentCollector({ time: 30_000 });

      collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: "Only the person who ran this command can confirm it.", ephemeral: true });
          return;
        }

        collector.stop("handled");

        if (i.customId === "deletedata_cancel") {
          await i.update({ content: "Deletion cancelled.", embeds: [], components: [] });
          return;
        }

        const processingEmbed = EmbedBuilder.from(i.message.embeds[0])
          .setTitle("Processing...")
          .setDescription("Deleting datastore entry…")
          .setColor(0x5865f2)
          .setFooter(null);
        await i.update({ embeds: [processingEmbed], components: [] });

        // Snapshot current value before deleting so it can be attached as a file
        const snapshot = await openCloud.GetDataStoreEntry(key, universeId, datastoreName);
        const hasSnapshot = snapshot.success && snapshot.data !== null;

        const result = await openCloud.DeleteDataStoreEntry(key, universeId, datastoreName, scope);

        if (result.success) {
          pushHistory(interaction.channelId, interaction.user.id, "deleteData", { key, universeId, datastoreName, scope });
        }

        const embed = buildDeleteDataEmbed(result, { key, universeId, datastoreName, scope }, universeInfo);

        if (hasSnapshot) {
          const jsonString = JSON.stringify(snapshot.data, null, 2);
          const fileBuffer = Buffer.from(jsonString, 'utf-8');
          const attachment = new AttachmentBuilder(fileBuffer, { name: `${key}_deleted_snapshot.txt` });
          await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
        } else {
          await interaction.editReply({ content: null, embeds: [embed] });
        }
      });

      collector.on("end", (_, reason) => {
        if (reason === "time") {
          interaction.editReply({ content: "Deletion timed out - no action taken.", embeds: [], components: [] }).catch(() => {});
        }
      });
    } catch (error) {
      console.error("Error in deletedata command:", error);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] });
    }
  },
};
