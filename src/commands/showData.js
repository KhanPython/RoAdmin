const { AttachmentBuilder, ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("../openCloudAPI");
const { buildShowDataEmbed, buildInternalErrorEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

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

    const check = await validateCommand(interaction, {
      key, universeId, datastoreName, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    try {

      // Get datastore entry
      const playerDataResult = await openCloud.GetDataStoreEntry(interaction.guildId, key, universeId, datastoreName);
      
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

      // Always attach full data as a .txt file
      const jsonString = JSON.stringify(playerDataResult.data, null, 2);
      const fileBuffer = Buffer.from(jsonString, 'utf-8');
      const attachment = new AttachmentBuilder(fileBuffer, { name: `${key}_data.txt` });

      await interaction.editReply({ embeds: [infoEmbed], files: [attachment] });
      
      return;
    } catch (error) {
      log.error("Error in showData command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] });
    }
  },
};
