const { EmbedBuilder, ApplicationCommandOptionType, MessageFlags, AttachmentBuilder } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { buildShowDataEmbed, formatJsonValue, buildErrorEmbed } = require("../utils/formatters");

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

    // Defer reply to prevent "Unknown interaction" timeout for long API calls
    await interaction.deferReply();

    try {
      // Check if API key is cached, if not prompt user
      if (!openCloud.hasApiKey(universeId)) {
        await interaction.editReply({
          embeds: [apiCache.createMissingApiKeyEmbed(universeId)],
        });
        return;
      }

      // Verify universe exists
      const universeCheck = await universeUtils.verifyUniverseExists(openCloud, universeId);
      if (!universeCheck.success) {
        await interaction.editReply({
          content: universeCheck.errorMessage,
        });
        return;
      }

      // Get datastore entry
      const playerDataResult = await openCloud.GetDataStoreEntry(key, universeId, datastoreName);
      
      if (!playerDataResult.success) {
        await interaction.editReply({
           content: `Failed to fetch key "${key}" in datastore "${datastoreName}": ${playerDataResult.status || 'Unknown error'}`
        });
        return;
      }

      if (playerDataResult.data === null || playerDataResult.data === undefined) {
        await interaction.editReply({
           content: `No data found for key "${key}" in datastore "${datastoreName}".`
        });
        return;
      }

      // Get universe info
      const universeInfo = await openCloud.GetUniverseName(universeId);

      // Build metadata embed from shared formatter
      const infoEmbed = buildShowDataEmbed(playerDataResult, { key, universeId, datastoreName }, universeInfo);

      // Format as code block for second embed / file
      const jsonString = JSON.stringify(playerDataResult.data, null, 2);
      const codeBlock = `\`\`\`json\n${jsonString}\n\`\`\``;

      if (codeBlock.length <= 4096) {
        const dataEmbed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setDescription(codeBlock);

        await interaction.editReply({ embeds: [infoEmbed, dataEmbed] });
      } else {
        const fileBuffer = Buffer.from(jsonString, 'utf-8');
        const attachment = new AttachmentBuilder(fileBuffer, { name: `${key}_data.json` });

        infoEmbed.addFields({ name: "Data", value: "Data is too large to display inline. See attached JSON file.", inline: false });

        await interaction.editReply({ embeds: [infoEmbed], files: [attachment] });
      }
      
      return;
    } catch (error) {
      console.error("Error in showData command:", error);
      
      // Truncate error message if too long for embed (max 4096 chars for embed description, but we need to be safe)
      let errorMessage = error.message || "An unknown error occurred";
      if (errorMessage.length > 1000) {
        errorMessage = errorMessage.substring(0, 997) + "...";
      }
      
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("Error")
          .setColor(0xFF0000)
          .setDescription(`Error: ${errorMessage}`)
          .setTimestamp()
        ],
      });
    }
  },
};
