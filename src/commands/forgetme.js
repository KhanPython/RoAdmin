const {
  ApplicationCommandOptionType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const apiCache = require("../utils/apiCache");
const llmCache = require("../utils/llmCache");
const { clearUserHistory, clearChannelHistories } = require("../nlp/nlpHandler");

module.exports = {
  category: "Privacy",
  description: "Delete data the bot stores about you or this server",
  slash: "both",
  guildOnly: true,
  permissions: ["ADMINISTRATOR"],
  options: [
    {
      name: "scope",
      description: "What data to delete",
      required: false,
      type: ApplicationCommandOptionType.String,
      choices: [
        { name: "My command history", value: "personal" },
        { name: "All server data (keys, consent, history)", value: "server" },
      ],
    },
  ],

  callback: async ({ interaction }) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const scope = interaction.options.getString("scope") || "personal";
    const guild = interaction.guild;

    const description =
      scope === "personal"
        ? "This will delete:\n" +
          "\u2022 Your NLP command history across all channels\n\n" +
          "This action cannot be undone."
        : "This will delete:\n" +
          "\u2022 All stored Roblox API keys for every universe on this server\n" +
          "\u2022 The Anthropic LLM API key for this server\n" +
          "\u2022 Data processing consent for this server\n" +
          "\u2022 All NLP command history for this server's channels\n\n" +
          "**All administrators will need to reconfigure API keys after this.**\n" +
          "This action cannot be undone.";

    const embed = new EmbedBuilder()
      .setTitle(`Delete ${scope === "personal" ? "Personal" : "Server"} Data`)
      .setDescription(description)
      .setColor(0xff0000)
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("forgetme_confirm")
        .setLabel("Delete Data")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("forgetme_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    const reply = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = reply.createMessageComponentCollector({ time: 60_000 });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: "Only the person who issued this command can confirm it.", ephemeral: true });
        return;
      }

      collector.stop("handled");

      if (i.customId === "forgetme_cancel") {
        await i.deferUpdate();
        await interaction.deleteReply();
        return;
      }

      const processingEmbed = EmbedBuilder.from(i.message.embeds[0])
        .setTitle("Processing...")
        .setDescription("Removing stored data…")
        .setColor(0x5865f2);
      await i.update({ embeds: [processingEmbed], components: [] });

      const deleted = [];

      if (scope === "personal") {
        const count = clearUserHistory(interaction.user.id);
        deleted.push(`Command history (${count} entries)`);
      } else {
        // Server-wide wipe
        if (guild) {
          apiCache.clearGuildApiKeys(guild.id);
          deleted.push("All API keys for this server");

          llmCache.clearGuildLlmKey(guild.id);
          deleted.push("LLM API key");

          apiCache.revokeConsent(guild.id);
          deleted.push("Data processing consent");

          const channelIds = guild.channels.cache.map(c => c.id);
          const count = clearChannelHistories(channelIds);
          deleted.push(`Command history (${count} entries)`);
        }
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle("Data Deleted")
        .setDescription(
          "The following data has been removed:\n" +
          deleted.map(d => `\u2022 ${d}`).join("\n")
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [resultEmbed], components: [] });
    });

    collector.on("end", (_, reason) => {
      if (reason === "time") {
        interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  },
};
