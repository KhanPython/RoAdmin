const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { sendPaginatedList } = require("../utils/pagination");
const { formatBanEntries, buildErrorEmbed } = require("../utils/formatters");

module.exports = {
  category: "Moderation",
  description: "List all active bans in a universe with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 1,
  expectedArgs: "<universeId>",
  guildOnly: true,

  options: [
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[0]);

    if (!universeId || isNaN(universeId)) {
      await interaction.reply({ content: "Please provide a valid Universe ID.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

      pushHistory(interaction.channelId, interaction.user.id, "listBans", { universeId });

      await sendPaginatedList({
        authorId: user.id,
        title: `Active Bans - ${universeInfo.name}`,
        iconUrl: universeInfo.icon ?? null,
        fetchPage: (pt) => openCloud.ListBans(universeId, pt),
        formatEntries: formatBanEntries,
        sendInitial: (opts) => interaction.editReply(opts),
        editFn: (opts) => interaction.editReply(opts),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (error) {
      console.error("Error in listbans command:", error);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] }).catch(() => {});
    }
  },
};
