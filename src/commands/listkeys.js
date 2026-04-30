const {
  ApplicationCommandOptionType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");
const openCloud = require("../openCloudAPI");
const { pushHistory } = require("../utils/commandHistory");
const { sendPaginatedList } = require("../utils/pagination");
const {
  buildListKeysEmbed,
  buildShowDataEmbed,
  buildInternalErrorEmbed,
} = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Player Data",
  description: "List all entry keys in a datastore with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
  minArgs: 2,
  expectedArgs: "<universeid> <datastore> [scope]",
  guildOnly: true,

  options: [
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "datastore",
      description: "The datastore name",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "scope",
      description: "The datastore scope (default: global)",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[0]);
    const datastoreName = interaction?.options?.getString("datastore") || args[1];
    const scope = interaction?.options?.getString("scope") || args[2] || "global";

    const check = await validateCommand(interaction, {
      universeId, datastoreName, scope, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    try {

      pushHistory(interaction.channelId, interaction.user.id, "listKeys", { universeId, datastoreName, scope });

      const buildEmbed = (data, pageNum) =>
        buildListKeysEmbed(data, pageNum, {
          universeId,
          scope,
          universeName: universeInfo.name,
          datastoreName,
          iconUrl: universeInfo.icon ?? null,
        });

      const buildExtraRows = (data) => {
        const keys = (data.keys || []).slice(0, 25);
        if (!keys.length) return [];
        const opts = keys.map(k => ({
          label: String(k).slice(0, 100),
          value: String(k).slice(0, 100),
          description: "View this entry",
        }));
        const select = new StringSelectMenuBuilder()
          .setCustomId("lk_show_select")
          .setPlaceholder("View an entry's value…")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(opts);
        return [new ActionRowBuilder().addComponents(select)];
      };

      const onComponent = async ({ interaction: sel }) => {
        if (sel.customId !== "lk_show_select") return;
        const key = sel.values?.[0];
        if (!key) {
          await sel.reply({ content: "Invalid selection.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        await sel.deferUpdate().catch(() => {});
        const result = await openCloud.GetDataStoreEntry(interaction.guildId, key, universeId, datastoreName);
        if (!result.success) {
          await interaction.followUp({
            content: `Failed to fetch key \`${key}\`: ${result.status || "unknown error"}`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }
        if (result.data === null || result.data === undefined) {
          await interaction.followUp({
            content: `No data found for key \`${key}\`.`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }
        const showEmbed = buildShowDataEmbed(result, { key, universeId, datastoreName }, universeInfo);
        const jsonString = JSON.stringify(result.data, null, 2);
        const attachment = new AttachmentBuilder(Buffer.from(jsonString, "utf-8"), { name: `${key}_data.json` });
        await interaction.followUp({
          embeds: [showEmbed],
          files: [attachment],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      };

      await sendPaginatedList({
        authorId: user.id,
        title: `Keys - ${datastoreName}`,
        iconUrl: universeInfo.icon ?? null,
        fetchPage: (pt) => openCloud.ListDataStoreKeys(interaction.guildId, universeId, datastoreName, scope, pt),
        buildEmbed,
        buildExtraRows,
        onComponent,
        sendInitial: (opts) => interaction.editReply(opts),
        editFn: (opts) => interaction.editReply(opts),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (error) {
      log.error("Error in listkeys command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] }).catch(() => {});
    }
  },
};
