require("dotenv/config");
const { Client, IntentsBitField } = require("discord.js");
const parseAndReply = require("./parse-and-reply.js");
const chatWithGpt = require("./chat-with-gpt.js");

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

// 🔒 prevents multiple simultaneous OpenAI calls (VERY important for free tier)
let busy = false;

// 🧠 safe wrapper (prevents 429 spikes)
async function safeChat(fn) {
  while (busy) {
    await new Promise((r) => setTimeout(r, 300));
  }

  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

client.on("ready", () => {
  console.log("The bot is online!");
});

const channelMemory = new Map(); // per-channel memory

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content.toLowerCase().startsWith("quiet")) return;

  const wasMentioned = message.mentions.has(client.user);

  const isReplyToBot = message.reference?.messageId
    ? await message.channel.messages
        .fetch(message.reference.messageId)
        .then((ref) => ref.author.id === client.user.id)
        .catch(() => false)
    : false;

  if (!wasMentioned && !isReplyToBot) return;

  const userInput = message.content
    .replace(/<@!?\\d+>/g, "")
    .replace(/<@&\\d+>/g, "")
    .trim();

  await message.channel.sendTyping();

  // 🔒 per-channel memory (safe + lightweight)
  let memory = channelMemory.get(message.channel.id) || [];

  // keep only last 6 exchanges
  memory = memory.slice(-6);

  const conversationLog = [
    {
      role: "system",
      content:
        "You are a helpful Ruby on Rails tutor. Be concise. Use Ruby examples when helpful.",
    },
    ...memory,
    {
      role: "user",
      content: userInput,
    },
  ];

  let busy = false;

  const safeChat = async (fn) => {
    while (busy) {
      await new Promise((r) => setTimeout(r, 300));
    }
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };

  const sendTypingInterval = setInterval(() => {
    message.channel.sendTyping();
  }, 8000);

  try {
    const gptResponse = await safeChat(() =>
      chatWithGpt(conversationLog)
    );

    clearInterval(sendTypingInterval);

    if (!gptResponse) {
      return message.reply("OpenAI is busy right now. Try again soon.");
    }

    // 💾 store only what matters (NOT raw Discord logs)
    memory.push(
      { role: "user", content: userInput },
      { role: "assistant", content: gptResponse }
    );

    channelMemory.set(message.channel.id, memory);

    await parseAndReply(gptResponse, message);
  } catch (err) {
    clearInterval(sendTypingInterval);
    console.error("Bot error:", err);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);