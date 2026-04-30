const {
  ApplicationCommandOptionType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
const openCloud = require("../openCloudAPI");
const robloxUserInfo = require("../robloxUserInfo");
const { pushHistory } = require("../utils/commandHistory");
const { sendPaginatedList } = require("../utils/pagination");
const {
  buildListBansEmbed,
  buildUnbanEmbed,
  buildInternalErrorEmbed,
} = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Moderation",
  description: "List all active bans in a universe with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
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

    const check = await validateCommand(interaction, {
      universeId, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    try {

      pushHistory(interaction.channelId, interaction.user.id, "listBans", { universeId });

      // Per-page user info cache, populated lazily inside buildEmbed.
      const userInfoMap = new Map();

      const buildEmbed = (data, pageNum) => {
        const { embed } = buildListBansEmbed(data, pageNum, {
          universeName: universeInfo.name,
          iconUrl: universeInfo.icon,
        }, userInfoMap);
        return embed;
      };

      const fetchAndResolve = async (pt) => {
        const data = await openCloud.ListBans(interaction.guildId, universeId, pt);
        if (data.success) {
          const ids = (data.bans || [])
            .map(b => b.user?.replace("users/", ""))
            .filter(Boolean);
          const resolved = await robloxUserInfo.getDisplayInfoMany(ids).catch(() => new Map());
          for (const [id, info] of resolved) userInfoMap.set(id, info);
        }
        return data;
      };

      const buildExtraRows = (data) => {
        const ids = (data.bans || [])
          .map(b => b.user?.replace("users/", ""))
          .filter(Boolean);
        if (!ids.length) return [];
        const opts = ids.slice(0, 25).map(id => {
          const info = userInfoMap.get(String(id));
          const label = info
            ? `${(info.displayName || info.username || id)}`.slice(0, 100)
            : `User ${id}`;
          const description = info?.username && info.username !== info.displayName
            ? `@${info.username} · ${id}`.slice(0, 100)
            : String(id).slice(0, 100);
          return { label, description, value: String(id) };
        });
        const select = new StringSelectMenuBuilder()
          .setCustomId("lb_unban_select")
          .setPlaceholder("Unban a user from this page…")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(opts);
        return [new ActionRowBuilder().addComponents(select)];
      };

      const onComponent = async ({ interaction: btn, refresh }) => {
        if (btn.customId !== "lb_unban_select") return;
        const targetId = Number(btn.values?.[0]);
        if (!Number.isFinite(targetId)) {
          await btn.reply({ content: "Invalid selection.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        await btn.deferUpdate().catch(() => {});
        const [response, info] = await Promise.all([
          openCloud.UnbanUser(interaction.guildId, targetId, universeId),
          robloxUserInfo.getUserDisplayInfo(targetId).catch(() => null),
        ]);
        if (response.success) {
          pushHistory(interaction.channelId, interaction.user.id, "unban", { userId: targetId, universeId });
        }
        await interaction.followUp({
          embeds: [buildUnbanEmbed(response, { userId: targetId, universeId }, universeInfo, info)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        await refresh();
      };

      await sendPaginatedList({
        authorId: user.id,
        title: `Active Bans - ${universeInfo.name}`,
        iconUrl: universeInfo.icon ?? null,
        fetchPage: fetchAndResolve,
        buildEmbed,
        buildExtraRows,
        onComponent,
        sendInitial: (opts) => interaction.editReply(opts),
        editFn: (opts) => interaction.editReply(opts),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (error) {
      log.error("Error in listbans command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] }).catch(() => {});
    }
  },
};
