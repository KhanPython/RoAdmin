const { EmbedBuilder, ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { buildRemoveFromBoardEmbed, buildErrorEmbed } = require("../utils/formatters");

module.exports = {
  category: "Moderation",
  description: "Removes leaderboard entry for a user",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 3,
  expectedArgs: "<userId> <leaderboardName> <universeId> [key]",
  guildOnly: true,

  options: [
    {
      name: "userid",
      description: "The user ID to remove from leaderboard",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "leaderboard",
      description: "The leaderboard name",
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
      name: "key",
      description: "The specific key to remove (optional, defaults to {userId})",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const userId = interaction?.options?.getNumber("userid") || parseInt(args[0]);
    const leaderboardName = interaction?.options?.getString("leaderboard") || args[1];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[2]);
    const key = interaction?.options?.getString("key") || args[3] || null;

    // Validate userId
    if (isNaN(userId)) {
      return "Invalid user ID. Please provide a valid number.";
    }

    // Validate universeId
    if (!universeId || isNaN(universeId)) {
      return "Please provide a valid Universe ID.";
    }

    try {
      // Check if API key is cached, if not prompt user
      if (!openCloud.hasApiKey(universeId)) {
        await interaction.reply({
          embeds: [apiCache.createMissingApiKeyEmbed(universeId)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Verify universe exists
      const universeCheck = await universeUtils.verifyUniverseExists(openCloud, universeId);
      if (!universeCheck.success) {
        await interaction.reply({
          content: universeCheck.errorMessage,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const universeInfo = universeCheck.universeInfo;
      
      // First check if the key exists in the datastore
      const keyToCheck = key || `${userId}`;
      const checkResult = await openCloud.CheckOrderedDataStoreKey(keyToCheck, leaderboardName, "global", universeId);
      
      if (!checkResult.exists) {
        const notFoundEmbed = new EmbedBuilder()
          .setTitle(`Remove Leaderboard Entry`)
          .setColor(0xFFFF00)
          .setDescription(`**Experience:** ${universeInfo.name}\n\n⚠️ ${checkResult.message}`)
          .addFields(
            { name: "UserId:", value: userId.toString(), inline: true },
            { name: "Universe ID:", value: universeId.toString(), inline: true },
            { name: "Leaderboard Name:", value: leaderboardName, inline: true },
            { name: "Key searched:", value: keyToCheck, inline: true }
          )
          .setTimestamp();
        
        if (universeInfo.icon) {
          notFoundEmbed.setThumbnail(universeInfo.icon);
        }
        
        return notFoundEmbed;
      }

      // Key exists, proceed with removal
      const response = await openCloud.RemoveOrderedDataStoreData(userId, leaderboardName, key, "global", universeId);

      if (response.success) {
        pushHistory(interaction.channelId, interaction.user.id, "removeFromBoard", { userId, leaderboardName, key, universeId });
      }

      return buildRemoveFromBoardEmbed(response, { userId, universeId, leaderboardName, key }, universeInfo);
    } catch (error) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("Error")
          .setColor(0xFF0000)
          .setDescription("An unexpected error occurred")
          .addFields({ name: "Error:", value: error.message })
          .setTimestamp()
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
