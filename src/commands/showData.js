const { EmbedBuilder, ApplicationCommandOptionType, MessageFlags, AttachmentBuilder } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
//

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

      // Format the data for display
      const entryData = playerDataResult.data;
      const jsonString = JSON.stringify(entryData, null, 2); // Pretty print with 2-space indent
      
      // Create main embed with metadata
      const infoEmbed = new EmbedBuilder()
        .setTitle(`Datastore Entry`)
        .setColor(0x0099FF)
        .addFields(
          { name: "Experience", value: `${universeInfo.name}`, inline: true },
          { name: "Key", value: `${key}`, inline: true },
          { name: "Universe ID", value: `${universeId}`, inline: true },
          { name: "Datastore", value: `${datastoreName}`, inline: true },
          { name: "Data Size", value: `${jsonString.length} bytes`, inline: true }
        )
        .setFooter({ text: "Datastore Entry Information" })
        .setTimestamp();
      
      if (universeInfo.icon) {
        infoEmbed.setThumbnail(universeInfo.icon);
      }

      // Format as code block
      const codeBlock = `\`\`\`json\n${jsonString}\n\`\`\``;

      // Check if data fits in embed description (Discord text limit is 4096 chars)
      if (codeBlock.length <= 4096) {
        // Use a second embed to display the data BELOW the metadata fields
        const dataEmbed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setDescription(codeBlock);

        await interaction.reply({
          embeds: [infoEmbed, dataEmbed],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        // Large data: send as file attachment
        const fileBuffer = Buffer.from(jsonString, 'utf-8');
        const attachment = new AttachmentBuilder(fileBuffer, { name: `${key}_data.json` });
        
        infoEmbed.addFields({
           name: "Data",
           value: "Data is too large to display inline. See attached JSON file.",
           inline: false
        });
        
        await interaction.reply({
          embeds: [infoEmbed],
          files: [attachment],
          flags: MessageFlags.Ephemeral,
        });
      }
      
      return;
    } catch (error) {
      console.error("Error in showData command:", error);
      
      // Truncate error message if too long for embed (max 4096 chars for embed description, but we need to be safe)
      let errorMessage = error.message || "An unknown error occurred";
      if (errorMessage.length > 1000) {
        errorMessage = errorMessage.substring(0, 997) + "...";
      }
      
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("Error")
          .setColor(0xFF0000)
          .setDescription(`Error: ${errorMessage}`)
          .setTimestamp()
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
