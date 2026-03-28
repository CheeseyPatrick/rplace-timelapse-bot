import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  type MessageCreateOptions,
  type MessagePayload,
  type Snowflake,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  BitFieldResolvable,
  Message,
  SnowflakeUtil,
  Collection,
  MessageReplyOptions,
} from "discord.js";
import { config } from "dotenv";
import { randomBytes } from "crypto";
import { currentCanvas } from "./ipcHandler";
config();

type ChannelName = "#live" | "#every10Minutes" | "#everyDay" | "#everyWeek";
const CHANNELS = new Map<ChannelName, Snowflake>([
  ["#live", "1402823263473897505"],
  ["#every10Minutes", "1484948067928113253"],
  ["#everyDay", "1480330317041500220"],
  ["#everyWeek", "1480330338201899274"],
]);

const CHEESEY = "837052710339215382";

if (!process.env.DISCORD_TOKEN) {
  throw new Error(
    "Please set DISCORD_TOKEN environment variable, it was not found.",
  );
}
const token = process.env.DISCORD_TOKEN;

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

let lastMessage: Message | null = null;

client.on("messageCreate", async (message) => {
  if (message.guild?.id === "1402823262957994095" && !message.author.bot) {
    lastMessage = message;
  }

  if (
    message.author.id === CHEESEY &&
    message.cleanContent.toLowerCase().startsWith("eval")
  ) {
    const match = message.content.match(/```(?:js|ts)?\n?([\s\S]*?)```/);

    if (!match) {
      await message.reply("No code block found.");
      return;
    }

    const code = match[1];

    try {
      let result = await eval(`(async()=>{${code}})();`);

      if (typeof result !== "string") {
        result = JSON.stringify(result, null, 2) ?? String(result);
      }

      const formatted = `\`\`\`js\n${result}\n\`\`\``;

      if (formatted.length > 1999) {
        await message.reply({
          files: [
            new AttachmentBuilder(Buffer.from(result), { name: "result.js" }),
          ],
        });
      } else {
        await message.channel.send(formatted);
      }
    } catch (err) {
      const error = err as Error;
      await message.channel.send(
        `\`\`\`\n${error.name}: ${error.message}\n\`\`\``,
      );
    }
  }
});

export async function reply(
  content: string | MessagePayload | MessageReplyOptions,
) {
  if (!lastMessage) {
    throw new Error("No message to reply to");
  }
  const message = lastMessage;

  await message.reply(content);
}

export class CheeseyFile {
  buffer: Buffer = Buffer.from([0x62, 0x75, 0x66, 0x66, 0x65, 0x72]);
  fileExtension: string = ".bat";

  constructor(
    buffer: typeof this.buffer,
    fileExtension: typeof this.fileExtension,
  ) {
    this.buffer = buffer;
    this.fileExtension = fileExtension;
  }

  static from(buffer: Buffer, fileExtension: string) {
    return new CheeseyFile(buffer, fileExtension);
  }

  /**
   * @param name The name of the file without a file extension
   */
  toDiscordAttachment(name?: string | undefined) {
    if (name === undefined) {
      name = `rchives${randomBytes(8).toString("hex")}`;
    }

    return new AttachmentBuilder(this.buffer, {
      name: `${name}.${this.fileExtension}`,
    });
  }
}

export async function sendFiles(
  channelName: ChannelName,
  files: AttachmentBuilder[],
  content: string | undefined = undefined,
) {
  if (!CHANNELS.has(channelName)) {
    throw new Error(`Unknown channel: ${channelName}`);
  }
  const channel = await client.channels.fetch(CHANNELS.get(channelName)!);

  if (!channel) {
    throw new Error(`Channel not fetched: ${channelName}`);
  }

  if (channel.isSendable()) {
    await channel.send({
      files,
      flags: [MessageFlags.SuppressNotifications],
      content,
    });
  } else {
    throw new Error(`Channel is not sendable: ${channelName} ${channel.id}`);
  }
}
let started = 0;
export async function startBot() {
  if (started === 1) return;
  started = 1;
  await client.login(token);
}

export async function sendMessage(
  channelName: ChannelName,
  message: string | MessagePayload | MessageCreateOptions,
) {
  if (!CHANNELS.has(channelName)) {
    throw new Error(`Unknown channel: ${channelName}`);
  }

  const channel = await client.channels.fetch(CHANNELS.get(channelName)!);

  if (!channel) {
    throw new Error(`Channel not fetched: ${channelName}`);
  }

  if (channel.isSendable()) {
    return await channel.send(message);
  } else {
    throw new Error(`Channel is not sendable: ${channelName} ${channel.id}`);
  }
}

export function buildErrorMessage(err: Error) {
  return {
    flags: [MessageFlags.IsComponentsV2],
    components: [
      new ContainerBuilder()
        .setAccentColor(0xed4245) // Discord red

        // ── Header section with thumbnail ──────────────────────
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                "## ❌  Something went wrong",
              ),
              new TextDisplayBuilder().setContent("<@837052710339215382>!!!"),
              new TextDisplayBuilder().setContent(
                `**${err.name}:** ${err.message}`,
              ),
            )
            .setThumbnailAccessory(
              new ThumbnailBuilder().setURL(
                "https://cdn.discordapp.com/avatars/1402817233901846598/b757d3c8a76b54959dc014f92de9f40d.webp?size=128",
              ),
            ),
        )

        // ── Divider ────────────────────────────────────────────
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Large),
        )

        // ── Stack trace ────────────────────────────────────────
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Stack trace**\n\`\`\`\n${(err.stack ?? "No stack available").slice(0, 900)}\n\`\`\``,
          ),
        )

        // ── Divider ────────────────────────────────────────────
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small),
        )

        // ── Timestamp footer + dismiss button ──────────────────
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `-# 🕐 Occurred at <t:${Math.floor(Date.now() / 1000)}:F>`,
              ),
            )
            .setButtonAccessory(
              new ButtonBuilder()
                .setCustomId("dismiss_error")
                .setLabel("Dismiss")
                .setStyle(ButtonStyle.Secondary),
            ),
        ),
    ],
  };
}

export async function sendErrorMessage(channelName: ChannelName, err: Error) {
  try {
    const errorMessage = buildErrorMessage(err);
    await sendMessage(channelName, {
      flags: errorMessage.flags as any,
      components: errorMessage.components,
    });
  } catch (error) {
    console.error(`Error sending error message of "${err}": ${error}`);
  }
}

export async function updateBanner() {
  if (currentCanvas) {
    const imageBuffer = currentCanvas.toBuffer("image/png");

    await client.user?.setBanner(imageBuffer);
  }
}

export async function getMessages(
  channelName: ChannelName,
  startMs: number,
  endMs: number,
) {
  if (!CHANNELS.has(channelName)) {
    throw new Error(`Unknown channel: ${channelName}`);
  }

  const channel = await client.channels.fetch(CHANNELS.get(channelName)!);

  if (!channel) {
    throw new Error(`Channel not fetched: ${channelName}`);
  }

  if (!channel.isTextBased()) {
    throw new Error(`Channel is not text-based: ${channelName}`);
  }

  const messages: Message[] = [];

  let before: Snowflake | undefined = SnowflakeUtil.generate({
    timestamp: endMs,
  }).toString();

  while (true) {
    const batch = (await channel.messages.fetch({
      limit: 100,
      before,
    })) as Collection<string, Message<boolean>>;

    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      const ts = msg.createdTimestamp;

      if (ts < startMs) {
        // We've gone past the start window — stop fetching entirely
        return messages;
      }

      if (ts <= endMs) {
        messages.push(msg);
      }
    }

    // The oldest message in this batch becomes the next cursor
    before = batch.last()!.id;
  }

  return messages;
}
