const { EmbedBuilder, ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");

module.exports = {
  category: "Player Data",
  description: "View data from a datastore using a specific entry key",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 3,
  expectedArgs: "<key> <universeId> <datastore>",
  guildOnly: true,

  options: [
    {
      name: "key",
      description: "The datastore entry key",
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
      description: "The datastore name (required)",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const key = interaction?.options?.getString("key") || args[0];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);
    const datastoreName = interaction?.options?.getString("datastore") || args[2];

    // Validate key
    if (!key || key.trim().length === 0) {
      return "Please provide a valid entry key.";
    }

    // Validate universeId
    if (!universeId || isNaN(universeId)) {
      return "Please provide a valid Universe ID.";
    }

    // Validate datastoreName
    if (!datastoreName || datastoreName.trim().length === 0) {
      return "Please provide a datastore name.";
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

      // Get datastore entry
      const playerDataResult = await openCloud.GetDataStoreEntry(key, universeId, datastoreName);
      
      if (!playerDataResult.success || !playerDataResult.data) {
        return `No data found for key "${key}" in datastore "${datastoreName}".`;
      }

      // Get universe info
      const universeInfo = await openCloud.GetUniverseName(universeId);

      // Build data fields
      const entryData = playerDataResult.data;
      const fields = [];

      // Add any fields from the data object
      for (const [dataKey, value] of Object.entries(entryData)) {
        fields.push({
          name: dataKey.charAt(0).toUpperCase() + dataKey.slice(1),
          value: typeof value === "object" ? JSON.stringify(value) : String(value),
          inline: true
        });
      }

      // Create embed response
      const embed = new EmbedBuilder()
        .setTitle(`Datastore Entry: ${key}`)
        .setColor(0x0099FF)
        .setDescription(`**Experience:** ${universeInfo.name}`)
        .addFields(
          { name: "Key", value: key, inline: true },
          { name: "Universe ID", value: universeId.toString(), inline: true },
          { name: "Datastore", value: datastoreName, inline: true }
        );

      if (fields.length > 0) {
        embed.addFields(fields);
      } else {
        embed.addFields({ name: "Data", value: "No data stored", inline: false });
      }

      embed
        .setFooter({ text: "Datastore Entry Information" })
        .setTimestamp();
      
      if (universeInfo.icon) {
        embed.setThumbnail(universeInfo.icon);
      }
      
      return embed;
    } catch (error) {
      console.error("Error in showData command:", error);
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
