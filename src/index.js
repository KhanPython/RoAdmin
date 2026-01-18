require('dotenv').config();

//Polyfill for undici compatibility
const { ReadableStream } = require("node:stream/web");
globalThis.ReadableStream = ReadableStream;

//Modules
const discord = require("discord.js");
const wokcommands = require("wokcommands");
const path = require("path");

const discordToken = process.env.DISCORD_TOKEN;

if (!discordToken) {
    console.error("❌ Discord Token is undefined! Check your .env file or GitHub Secrets.");
}

const client = new discord.Client({
  intents: [discord.IntentsBitField.Flags.Guilds, discord.IntentsBitField.Flags.GuildMessages],
  allowedMentions: { parse: ["users"] },
});

client.on("clientReady", async () => {
  try {
    // Clear all global commands
    await client.application?.commands.set([]);
    console.log("Cleared all global commands");
    
    // Now load new commands
    new wokcommands(client, {
      commandsDir: path.join(__dirname, "commands"),
      // featuresDir: path.join(__dirname, "features"),
      mongoUri: "",
    });

    console.log("Bot is ready!");
  } catch (error) {
    console.error("Error:", error);
  }
});

client.login(discordToken);
