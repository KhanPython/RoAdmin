const { EmbedBuilder, ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");

module.exports = {
  category: "Player Data",
  description: "View player data including currency and other stored information using their UserId",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 2,
  expectedArgs: "<userId> <universeId> [datastore]",
  guildOnly: true,

  options: [
    {
      name: "userid",
      description: "The Roblox user identification",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "datastore",
      description: "The datastore name (default: player_currency)",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const userId = interaction?.options?.getNumber("userid") || parseInt(args[0]);
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);
    const datastoreName = interaction?.options?.getString("datastore") || args[2] || "player_currency";

    // Validate userId
    if (!userId || isNaN(userId)) {
      return "Please provide a valid User ID.";
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

      // Get player data
      const playerDataResult = await openCloud.GetPlayerData(userId, universeId, datastoreName);
      
      if (!playerDataResult.success || !playerDataResult.data) {
        return `No player data found for user ${userId} in datastore "${datastoreName}".`;
      }

      // Get universe info
      const universeInfo = await openCloud.GetUniverseName(universeId);

      // Build player data fields
      const playerData = playerDataResult.data;
      const fields = [];

      // Add currency field if it exists
      if (playerData.currency !== undefined) {
        fields.push({
          name: "Currency",
          value: playerData.currency.toString(),
          inline: true
        });
      }

      // Add last updated field if it exists
      if (playerData.lastUpdated) {
        fields.push({
          name: "Last Updated",
          value: new Date(playerData.lastUpdated).toLocaleString(),
          inline: true
        });
      }

      // Add any other fields from the data object
      for (const [key, value] of Object.entries(playerData)) {
        if (key !== "currency" && key !== "lastUpdated") {
          fields.push({
            name: key.charAt(0).toUpperCase() + key.slice(1),
            value: typeof value === "object" ? JSON.stringify(value) : value.toString(),
            inline: true
          });
        }
      }

      // Create embed response
      const embed = new EmbedBuilder()
        .setTitle(`Player Data for ${userId}`)
        .setColor(0x0099FF)
        .setDescription(`**Experience:** ${universeInfo.name}`)
        .addFields(
          { name: "User ID", value: userId.toString(), inline: true },
          { name: "Universe ID", value: universeId.toString(), inline: true },
          { name: "Datastore", value: datastoreName, inline: true }
        );

      if (fields.length > 0) {
        embed.addFields(fields);
      } else {
        embed.addFields({ name: "Data", value: "No additional data stored", inline: false });
      }

      embed
        .setFooter({ text: "Player Data Information" })
        .setTimestamp();
      
      if (universeInfo.icon) {
        embed.setThumbnail(universeInfo.icon);
      }
      
      return embed;
    } catch (error) {
      console.error("Error in getdata command:", error);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("Error")
          .setColor(0xFF0000)
          .setDescription(`Error: ${error.message}`)
          .setTimestamp()
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
