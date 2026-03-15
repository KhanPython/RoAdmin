const {
  ApplicationCommandOptionType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
} = require("discord.js");

module.exports = {
  category: "Config",
  description: "Set the Roblox API key for a specific universe",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
  guildOnly: true,

  options: [
    {
      name: "universeid",
      description: "The Roblox universe ID",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
  ],

  callback: async ({ interaction }) => {
    const universeId = interaction?.options?.getNumber("universeid");

    if (!universeId || isNaN(universeId)) {
      await interaction.reply({
        content: "❌ Invalid Universe ID. Please provide a valid number.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`setapikey_modal_${universeId}`)
      .setTitle("Enter API Key");

    const apiKeyInput = new LabelBuilder()
      .setLabel("Roblox Open Cloud API Key")
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("apikey_input")
          .setPlaceholder("Paste your API key here")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(1000),
      );

    modal.addLabelComponents(apiKeyInput);

    await interaction.showModal(modal);
  },
};
