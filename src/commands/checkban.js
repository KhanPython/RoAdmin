const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("./../openCloudAPI");
const apiCache = require("./../utils/apiCache");
const universeUtils = require("./../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { buildCheckBanEmbed, buildErrorEmbed } = require("../utils/formatters");

module.exports = {
  category: "Moderation",
  description: "Check the ban status of a player by UserId",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 2,
  expectedArgs: "<userId> <universeId>",
  guildOnly: true,

  options: [
    {
      name: "userid",
      description: "The user ID to check",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const userId = interaction?.options?.getNumber("userid") || parseInt(args[0]);
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);

    if (!universeId || isNaN(universeId)) {
      return "Please provide a valid Universe ID.";
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

      const result = await openCloud.CheckBanStatus(userId, universeId);

      pushHistory(interaction.channelId, interaction.user.id, "checkBan", { userId, universeId });

      await interaction.editReply({ embeds: [buildCheckBanEmbed(result, { userId, universeId }, universeInfo)] });
    } catch (error) {
      console.error("Error in checkban command:", error);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] });
    }
  },
};
