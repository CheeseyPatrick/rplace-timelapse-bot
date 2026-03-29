import {
  CheeseyFile,
  sendErrorMessage,
  sendFiles,
  startBot,
  updateBanner,
} from "./discordBot";
import { startFrameGenerator } from "./frameGenerator";
import initWs from "./initWs";
import { startLapsing } from "./ultimateLapser";
import {
  encodeFramesToGif,
  encodeFramesToWebM,
  makeTimelapseAndUpload,
} from "./videoGenerator";

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

await Promise.all([initWs(), startFrameGenerator(), startBot()]);

await startLapsing();
