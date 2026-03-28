import { addIpcMessageHandler, handleIpcMessage } from "shared-ipc";
import {
  BOARD,
  connect,
  connectStatus,
  currentCanvas,
  HEIGHT,
  PALETTE,
  rplaceOn,
  sendIpcMessage,
  setConnectStatus,
  WIDTH,
} from "./ipcHandler";
import crypto from "crypto";
import { Worker } from "worker_threads";
import fs from "fs/promises";
import path from "path";

export let wsCapsule: Worker | null = null;

export let started = 0;

export default async function initWs() {
  if (started === 1) return;
  started = 1;
  let ws = null as null | Worker;
  try {
    console.log("Starting WebSocket Worker");
    ws = new Worker(new URL("./game-worker-wrapper.js", import.meta.url));

    ws.addListener("message", handleIpcMessage);

    const fingerprint = crypto.randomBytes(16).toString("hex");

    connect(fingerprint, "wss://server.rplace.live", undefined, ws);
    wsCapsule = ws;
  } catch (err) {
    console.error(
      "Error opening Websocket Worker",
      err,
      "Retrying in 10 seconds",
    );
    ws?.terminate().catch(() => {});
    setTimeout(initWs, 10000);
  }

  let interval: NodeJS.Timeout | null = null;
  interval = setInterval(() => {
    if (connectStatus === "disconnected") {
      console.log("Websocket disconnected. Reconnecting...");
      setConnectStatus("initial");
      clearInterval(interval!);
      wsCapsule?.terminate().catch(() => {});
      initWs();
    }
  }, 5000);
}
