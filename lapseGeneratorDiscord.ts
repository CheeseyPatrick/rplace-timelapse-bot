import { Message } from "discord.js";
import { CheeseyFile, getMessages, sendFiles, startBot } from "./discordBot";
import path from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { getPixelFormat, writeWithDrain } from "./videoGenerator";
import { HEIGHT, WIDTH } from "./ipcHandler";
import { readFile, unlink } from "fs/promises";
import { createCanvas, loadImage } from "canvas";

const pixelFormat = getPixelFormat();

function getTimes() {
  // run this function at midnight after the day of the wanted timelapse
  const now = new Date(Date.now() + 5 * 60 * 1000);

  const fiveHoursAgo = new Date(now);
  fiveHoursAgo.setHours(fiveHoursAgo.getHours() - 5);

  const twoHoursFromNow = new Date(now);
  twoHoursFromNow.setHours(twoHoursFromNow.getHours() + 2);

  const midnightYesterday = new Date(fiveHoursAgo);
  midnightYesterday.setHours(0, 0, 0, 0);

  const midnightToday = new Date(twoHoursFromNow);
  midnightToday.setHours(0, 0, 0, 0);

  const fiveMinutesBeforeMidnightYesterday = new Date(midnightYesterday);
  fiveMinutesBeforeMidnightYesterday.setMinutes(
    fiveMinutesBeforeMidnightYesterday.getMinutes() - 5,
  );

  const fiveMinutesAfterMidnightToday = new Date(midnightToday);
  fiveMinutesAfterMidnightToday.setMinutes(
    fiveMinutesAfterMidnightToday.getMinutes() + 5,
  );

  return {
    start: fiveMinutesBeforeMidnightYesterday,
    end: fiveMinutesAfterMidnightToday,
  };
}

export async function makeDailyTimelapse() {
  const times = getTimes();
  const messages = await getMessages(
    "#every10Minutes",
    times.start.getTime() - 24 * 60 * 60 * 1000,
    times.end.getTime(),
  );
  const sortedMessages = messages.sort((a, b) => {
    return a.createdTimestamp - b.createdTimestamp;
  });

  const framesToFetch = [] as Message<boolean>[];

  for (const message of sortedMessages) {
    const slice = framesToFetch.slice(-1);
    const latestFrame = slice[0];

    if (!latestFrame) {
      framesToFetch.push(message);
    } else {
      if (
        message.createdTimestamp - latestFrame.createdTimestamp >
        25 * 60 * 1000
      ) {
        framesToFetch.push(message);
      }
    }
  }

  if (framesToFetch.length === 0) {
    throw new Error(
      "There were no frames found in #every10Minutes to make a timelapse out of",
    );
  }

  const tmpFile = path.join(tmpdir(), `daily_timelapse_${Date.now()}.webm`);
  const inputFps = 4;
  const outputFps = 10;

  const ffmpeg = spawn("ffmpeg", [
    "-f",
    "rawvideo",
    "-pixel_format",
    pixelFormat,
    "-video_size",
    `${WIDTH}x${HEIGHT}`,
    "-framerate",
    String(inputFps),
    "-i",
    "pipe:0",
    "-r",
    String(outputFps),
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "0",
    "-g",
    "9999",
    "-b:v",
    "0",
    "-deadline",
    "realtime",
    "-cpu-used",
    "5",
    "-f",
    "webm",
    tmpFile,
  ]);

  ffmpeg.stderr.on("data", () => {});
  ffmpeg.on("error", (err) => {
    throw err;
  });

  const writePromise = new Promise<void>((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exited with code ${code}`));
      else resolve();
    });
    ffmpeg.on("error", reject);
    ffmpeg.stderr.on("data", (data: Buffer) => {});
  });

  for (const message of framesToFetch) {
    const attachment = message.attachments.first();
    if (!attachment) continue;
    const res = await fetch(attachment.url);
    const arrayBuffer = await res.arrayBuffer();

    const img = await loadImage(Buffer.from(arrayBuffer));
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    const rawBuffer = canvas.toBuffer("raw");

    await writeWithDrain(ffmpeg.stdin, rawBuffer);
  }
  ffmpeg.stdin.end();

  await writePromise;

  const videoBuffer = await readFile(tmpFile);
  await unlink(tmpFile).catch(() => {});

  const yesterday = new Date();
  yesterday.setHours(yesterday.getHours() - 5);
  const time = yesterday.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });

  await sendFiles(
    "#everyDay",
    [CheeseyFile.from(videoBuffer, "webm").toDiscordAttachment()],
    `${time}`,
  );
}
