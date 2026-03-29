import cron from "node-cron";
import { encodeFramesToAvi, makeTimelapseAndUpload } from "./videoGenerator";
import {
  CheeseyFile,
  sendErrorMessage,
  sendFiles,
  updateBanner,
} from "./discordBot";
import { makeFrame } from "./frameGenerator";
import { currentCanvas } from "./ipcHandler";
import { makeDailyTimelapse } from "./lapseGeneratorDiscord";

let started = 0;

export async function startLapsing() {
  if (started === 1) return;
  started = 1;

  // Every 30 seconds
  cron.schedule("*/30 * * * * *", async () => {
    try {
      await makeTimelapseAndUpload();
    } catch (err) {
      await sendErrorMessage("#live", err as Error);
    }
  });

  // Every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    if (currentCanvas) {
      try {
        const frame = makeFrame(true, true);
        const imageBuffer = frame!.toBuffer("image/png");
        const attachment = CheeseyFile.from(
          imageBuffer,
          "png",
        ).toDiscordAttachment();

        await sendFiles("#every10Minutes", [attachment]);
      } catch (err) {
        await sendErrorMessage("#every10Minutes", err as Error);
      }

      try {
        await updateBanner();
      } catch (err) {
        console.log("Error setting profile banner:", err);
      }
    }
  });

  // Every day at 12am
  cron.schedule(
    "0 0 * * *",
    async () => {
      setTimeout(async () => {
        try {
          await makeDailyTimelapse();
        } catch (err) {
          await sendErrorMessage("#everyDay", err as Error);
        }
      }, 2 * 1000);
    },
    { timezone: "America/New_York" },
  );

  // Every Monday at 12am
  cron.schedule("0 0 * * 1", async () => {}, { timezone: "America/New_York" });
}
