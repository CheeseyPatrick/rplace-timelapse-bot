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

await Promise.all([initWs(), startFrameGenerator(), startBot()]);

await startLapsing();
