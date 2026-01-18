const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");

const ENTRIES_PER_PAGE = 10;

module.exports = {
  category: "Debugging",
  description: "List all entries in an ordered datastore with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 2,
  expectedArgs: "<leaderboardName> <universeId> [scope]",
  guildOnly: true,

  options: [
    {
      name: "leaderboard",
      description: "The leaderboard/ordered datastore name",
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
      name: "scope",
      description: "The datastore scope (default: global)",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const leaderboardName = interaction?.options?.getString("leaderboard") || args[0];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);
    const scopeId = interaction?.options?.getString("scope") || args[2] || "global";

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
      
      // Fetch first page to get total count
      let response = await openCloud.ListOrderedDataStoreEntries(leaderboardName, scopeId, null, universeId);

      if (!response.success) {
        return new EmbedBuilder()
          .setTitle("Error")
          .setColor(0xFF0000)
          .setDescription(response.status)
          .setTimestamp();
      }

      let currentEntries = response.entries || [];
      let currentPageToken = response.nextPageToken || null;
      let currentPage = 0;

      if (currentEntries.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setTitle(`Leaderboard Entries - ${leaderboardName}`)
          .setColor(0xFFFF00)
          .setDescription(`**Experience:** ${universeInfo.name}\n\nNo entries found in this ordered datastore`)
          .addFields({ name: "Scope", value: scopeId })
          .setTimestamp();
        
        if (universeInfo.icon) {
          emptyEmbed.setThumbnail(universeInfo.icon);
        }
        
        return emptyEmbed;
      }

      // Function to generate page embed
      const generatePageEmbed = (page, hasNext) => {
        let entriesText = "";
        currentEntries.forEach((entry, index) => {
          const entryNumber = page * ENTRIES_PER_PAGE + index + 1;
          entriesText += `${entryNumber}. **${entry.id}** - Value: ${entry.value}\n`;
        });

        const embed = new EmbedBuilder()
          .setTitle(`Leaderboard Entries - ${leaderboardName}`)
          .setColor(0x00FF00)
          .setDescription(`**Experience:** ${universeInfo.name}\n\n${entriesText || "No entries"}`)
          .addFields({ name: "Scope", value: scopeId })
          .setFooter({ text: `Page ${page + 1}${hasNext ? " (more available)" : ""}` })
          .setTimestamp();
        
        if (universeInfo.icon) {
          embed.setThumbnail(universeInfo.icon);
        }
        
        return embed;
      };

      // Create pagination buttons
      const createButtons = (page, hasNext) => {
        const row = new ActionRowBuilder();

        if (page > 0) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("first")
              .setLabel("⏮ First")
              .setStyle(ButtonStyle.Primary)
          );
        }

        if (page > 0) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("prev")
              .setLabel("◀ Previous")
              .setStyle(ButtonStyle.Primary)
          );
        }

        if (hasNext) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("next")
              .setLabel("Next ▶")
              .setStyle(ButtonStyle.Primary)
          );
        }

        return row;
      };

      // Send initial message
      const initialEmbed = generatePageEmbed(currentPage, !!currentPageToken);
      const initialButtons = createButtons(currentPage, !!currentPageToken);
      
      const message = await interaction.reply({
        embeds: [initialEmbed],
        components: currentPageToken ? [initialButtons] : [],
        flags: MessageFlags.Ephemeral,
      });

      if (!currentPageToken) return; // No next page available

      // Handle button clicks
      const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === user.id,
        time: 5 * 60 * 1000, // 5 minutes
      });

      let previousPageTokens = []; // Store tokens to go back

      collector.on("collect", async (i) => {
        await i.deferUpdate();

        if (i.customId === "first") {
          // Go back to first page
          currentPage = 0;
          currentPageToken = null;
          previousPageTokens = [];

          const firstResponse = await openCloud.ListOrderedDataStoreEntries(
            leaderboardName,
            scopeId,
            null,
            universeId
          );

          if (firstResponse.success) {
            currentEntries = firstResponse.entries || [];
            currentPageToken = firstResponse.nextPageToken || null;

            const newEmbed = generatePageEmbed(currentPage, !!currentPageToken);
            const newButtons = createButtons(currentPage, !!currentPageToken);

            await message.edit({
              embeds: [newEmbed],
              components: previousPageTokens.length > 0 || currentPageToken ? [newButtons] : [],
            });
          }
        } else if (i.customId === "next" && currentPageToken) {
          // Store current token to go back
          previousPageTokens.push(currentPageToken);

          // Fetch next page
          const nextResponse = await openCloud.ListOrderedDataStoreEntries(
            leaderboardName,
            scopeId,
            currentPageToken,
            universeId
          );

          if (nextResponse.success) {
            currentEntries = nextResponse.entries || [];
            currentPageToken = nextResponse.nextPageToken || null;
            currentPage++;

            const newEmbed = generatePageEmbed(currentPage, !!currentPageToken);
            const newButtons = createButtons(currentPage, !!currentPageToken);

            await message.edit({
              embeds: [newEmbed],
              components: previousPageTokens.length > 0 || currentPageToken ? [newButtons] : [],
            });
          }
        } else if (i.customId === "prev" && previousPageTokens.length > 0) {
          // Go back to previous page
          currentPageToken = previousPageTokens.pop();
          currentPage--;

          const prevResponse = await openCloud.ListOrderedDataStoreEntries(
            leaderboardName,
            scopeId,
            previousPageTokens.length > 0 ? previousPageTokens[previousPageTokens.length - 1] : null,
            universeId
          );

          if (prevResponse.success) {
            currentEntries = prevResponse.entries || [];

            const newEmbed = generatePageEmbed(currentPage, !!currentPageToken);
            const newButtons = createButtons(currentPage, !!currentPageToken);

            await message.edit({
              embeds: [newEmbed],
              components: previousPageTokens.length > 0 || currentPageToken ? [newButtons] : [],
            });
          }
        }
      });

      collector.on("end", () => {
        // Remove buttons when pagination times out
        message.edit({ components: [] }).catch(() => {});
      });

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
