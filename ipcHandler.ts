"use strict";
import { type Worker } from "worker_threads";
import { wsCapsule } from "./initWs";
import {
  DEFAULT_BOARD,
  DEFAULT_BOARD_FALLBACK,
  DEFAULT_COOLDOWN,
  DEFAULT_HEIGHT,
  DEFAULT_PALETTE,
  DEFAULT_PALETTE_USABLE_REGION,
  DEFAULT_SERVER,
  DEFAULT_WIDTH,
  PLACEMENT_MODE,
  RENDERER_TYPE,
} from "./resources/defaults";

import {
  addIpcMessageHandler,
  handleIpcMessage,
  makeIpcRequest,
  sendIpcMessage as sharedIpcSendIpcMessage,
} from "shared-ipc";
import { type Canvas, createCanvas } from "canvas";

// Types
interface LiveChatMessage {
  messageId: number;
  content: string;
  senderIntId: number;
  senderChatName: string;
  sendDate: number;
  reactions: Map<string, Set<number>>;
  channel: string;
  repliesTo: number | null;
}

interface PlaceChatMessage {
  positionIndex: number;
  content: string;
  senderIntId: number;
  senderChatName: string;
}

interface ChatInfo {
  type: "live" | "place";
  message: LiveChatMessage | PlaceChatMessage;
  channel?: string; // Only present for live chat
}

interface LiveChatHistoryInfo {
  fromMessageId: number;
  count: number;
  before: boolean;
  channel: string;
  messages: LiveChatMessage[];
}

interface ModerationInfo {
  state: number; // The punishment state (mute/ban)
  startDate: number; // Timestamp in milliseconds
  endDate: number; // Timestamp in milliseconds
  reason: string; // Reason for punishment
  appeal: string; // Appeal status text
}

interface PaletteUsableRegion {
  start: number;
  end: number;
}

interface Pixel {
  position: number;
  colour: number;
  placer?: number;
}

interface RplaceEventMap {
  handleConnect: [];
  handlePalette: [[palette: number[], start: number, end: number]];
  handleCooldownInfo: [[endDate: Date, cooldown: number]];
  handleCanvasInfo: [[width: number, height: number]];
  handleChanges: [[width: number, height: number, changes: ArrayBuffer]];
  setOnline: [count: number];
  handlePlacerInfoRegion: [
    [position: number, width: number, height: number, region: ArrayBuffer],
  ];
  handleSetIntId: [userIntId: number];
  setCanvasLocked: [[locked: boolean, reason: string | null]];
  handlePixels: [pixels: Pixel[]];
  handleRejectedPixel: [[endDate: Date, position: number, colour: number]];
  handleCooldown: [endDate: Date];
  setChatName: [name: string];
  handleNameInfo: [newIntIdNames: Map<number, string>];
  addLiveChatMessage: [[message: LiveChatMessage, channel: string]];
  addPlaceChatMessage: [message: PlaceChatMessage];
  handleLiveChatDelete: [messageId: number];
  handleLiveChatReaction: [
    [messageId: number, reactorId: number, reactionKey: string],
  ];
  applyPunishment: [info: ModerationInfo];
  handleChallenge: [[source: string, input: string]];
  handleSpectating: [userIntId: number];
  handleUnspectating: [[userIntId: number, reason: string]];
  handleSpectated: [spectatorIntId: number];
  handleUnspectated: [spectatorIntId: number];
  handleDisconnect: [[code: number, reason: string]];
  handleHCaptcha: [[captchaId: number, siteKey: string]];
}

type ipcCallType = string | "putPixel" | "sendLiveChatMsg" | "sendPlaceChatMsg";

const localStorage = {
  lastDisconnect: undefined,
  board: undefined,
  boardFallback: undefined,
} as {
  lastDisconnect: undefined | string;
  board: undefined | string;
  boardFallback: undefined | string;
};

// Readonly WS-derived state
// Composited board with changes and socket pixels
export let BOARD: Uint8Array | null = null;
export let currentCanvas: Canvas | null = null;
// Raw board, changes and socket pixels layers
export let CHANGES: Uint8Array | null = null;
export let RAW_BOARD: Uint8Array | null = null;
export let SOCKET_PIXELS: Uint8Array | null = null;
export let PALETTE_USABLE_REGION: PaletteUsableRegion =
  DEFAULT_PALETTE_USABLE_REGION;
export let PALETTE: number[] = DEFAULT_PALETTE;
export let WIDTH: number = DEFAULT_WIDTH;
export let HEIGHT: number = DEFAULT_HEIGHT;
export let COOLDOWN: number = DEFAULT_COOLDOWN;

// Additional WS-derived state
export const intIdNames = new Map<number, string>(); // intId : name
export let intIdPositions = new Map<number, number>(); // position : intId
export let account: any | null = null;
export let intId: number | null = null;
export let chatName: string | null = null;
export let connectStatus:
  | "initial"
  | "connecting"
  | "connected"
  | "disconnected" = "initial";
export function setConnectStatus(status: typeof connectStatus) {
  connectStatus = status;
}
export let canvasLocked: boolean = false;
export let online: number = 0;
export let placementMode: PLACEMENT_MODE = PLACEMENT_MODE.selectPixel;
export const spectators = new Set<number>(); // Spectator int Id
export let spectatingIntId: number | null = null;

// Miscellaneous require global state
// Unix date for cooldown end (null = indefinite)
export let cooldownEndDate: number | null = null;
// Simple boolean interface for if currently on cooldown
export let onCooldown: boolean = false;
// We don't await this yet, when the changes (old server) / canvas width & height (new server) packet
// comes through, it will await this unawaited state until it is fulfilled, so we are sure we have all the data
export let preloadedBoard: Promise<ArrayBuffer | null> = fetchBoard();
let fetchCooldown: number = 50;
let fetchFailTimeout: ReturnType<typeof setTimeout> | null = null;

const originalAddIpcMessageHandler = addIpcMessageHandler;
const _addIpcMessageHandler = (type: string, handler: Function) => {
  originalAddIpcMessageHandler(type, (...args: any[]) => {
    //console.log("IPC message received:", type);
    const result = handler(...args); // original runs first

    // Emit to rplaceOn listeners after
    rplaceListeners.get(type)?.forEach((listener) => listener(...args));

    return result;
  });
};

_addIpcMessageHandler("handleConnect", () => {
  setConnectStatus("connected");
});
_addIpcMessageHandler(
  "handlePalette",
  ([palette, start, end]: [number[], number, number]) => {
    PALETTE = palette;
    PALETTE_USABLE_REGION.start = start;
    PALETTE_USABLE_REGION.end = end;
  },
);
_addIpcMessageHandler(
  "handleCooldownInfo",
  ([endDate, cooldown]: [Date, number]) => {
    COOLDOWN = cooldown;
  },
);
_addIpcMessageHandler(
  "handleCanvasInfo",
  async ([width, height]: [number, number]) => {
    // Used by RplaceServer
    setSize(width, height);

    const board = await preloadedBoard;
    if (!board) {
      throw new Error("Couldn't handle canvas info: Preloaded board was null");
    }

    const dataArr = new Uint8Array(board);
    BOARD = new Uint8Array(length);
    let boardI = 0;
    let colour = 0;

    for (let i = 0; i < board.byteLength; i++) {
      // Then it is a palette value
      if (i % 2 == 0) {
        colour = dataArr[i];
        continue;
      }
      // After colour, loop until we unpack all repeats, byte can only hold max 255,
      // so we add one to repeated data[i], and treat it as if 0 = 1 (+1)
      for (let j = 0; j < dataArr[i] + 1; j++) {
        BOARD[boardI] = colour;
        boardI++;
      }
    }
  },
);
_addIpcMessageHandler(
  "handleChanges",
  async ([width, height, changes]: [number, number, ArrayBuffer]) => {
    // Used by legacy server
    if (width != WIDTH || height != HEIGHT) {
      setSize(width, height);
    }

    const board = await preloadedBoard;
    if (!board) {
      throw new Error("Couldn't handle changes: Preloaded board was null");
    }

    RAW_BOARD = new Uint8Array(board);
    BOARD = new Uint8Array(RAW_BOARD);
    CHANGES = new Uint8Array(width * height).fill(255);
    SOCKET_PIXELS = new Uint8Array(width * height).fill(255);

    let i = 0;
    let boardI = 0;
    const view = new DataView(changes);
    while (i < changes.byteLength) {
      let cell = view.getUint8(i++);
      let c = cell >> 6;
      if (c == 1) c = view.getUint8(i++);
      else if (c == 2) ((c = view.getUint16(i++)), i++);
      else if (c == 3) ((c = view.getUint32(i++)), (i += 3));
      boardI += c;

      // Update both the working board and mark changes
      BOARD[boardI] = cell & 63;
      CHANGES[boardI] = cell & 63;
      boardI++;
    }
  },
);
_addIpcMessageHandler("setOnline", (count: number) => {
  online = count;
});
_addIpcMessageHandler(
  "handlePlacerInfoRegion",
  ([position, width, height, region]: [
    number,
    number,
    number,
    ArrayBuffer,
  ]) => {
    const regionView = new DataView(region);
    let i = position;
    let regionI = 0;
    while (regionI < region.byteLength) {
      for (let xi = i; xi < i + width; xi++) {
        const placerIntId = regionView.getUint32(regionI);
        if (placerIntId !== 0xffffffff) {
          intIdPositions.set(xi, placerIntId);
        }
        regionI += 4;
      }
      i += WIDTH;
    }
  },
);
_addIpcMessageHandler("handleSetIntId", (userIntId: number) => {
  intId = userIntId;
});
_addIpcMessageHandler(
  "setCanvasLocked",
  ([locked, reason]: [boolean, string | null]) => {
    canvasLocked = locked;
  },
);
_addIpcMessageHandler("handlePixels", (pixels: Pixel[]) => {
  for (const pixel of pixels) {
    setPixelI(pixel.position, pixel.colour);

    if (pixel.placer) {
      // Update positions cache
      intIdPositions.set(pixel.position, pixel.placer);
    }
  }
  setTimeout(updateCurrentCanvas, 3);
});
_addIpcMessageHandler(
  "handleRejectedPixel",
  ([endDate, position, colour]: [Date, number, number]) => {
    setPixelI(position, colour);
  },
);
_addIpcMessageHandler("handleCooldown", (endDate: Date) => {
  //
});
_addIpcMessageHandler("setChatName", (name: string) => {
  chatName = name;
});
_addIpcMessageHandler(
  "handleNameInfo",
  (newIntIdNames: Map<number, string>) => {
    for (const [key, value] of newIntIdNames.entries()) {
      intIdNames.set(key, value);
    }
  },
);
_addIpcMessageHandler(
  "addLiveChatMessage",
  ([message, channel]: [LiveChatMessage, string]) => {
    //
  },
);
_addIpcMessageHandler("addPlaceChatMessage", (message: PlaceChatMessage) => {
  //
});
_addIpcMessageHandler("handleLiveChatDelete", (messageId: number) => {
  //
});
_addIpcMessageHandler(
  "handleLiveChatReaction",
  ([messageId, reactorId, reactionKey]: [number, number, string]) => {
    //
  },
);
_addIpcMessageHandler("applyPunishment", (info: ModerationInfo) => {
  //
});
_addIpcMessageHandler(
  "handleChallenge",
  async ([source, input]: [string, string]) => {
    /*
    const result = await Object.getPrototypeOf(
      async function () {},
    ).constructor(source)(input);
    sendIpcMessage(wsCapsule, "sendChallengeResult", result);
    */
  },
);
_addIpcMessageHandler("handleSpectating", (userIntId: number) => {
  spectatingIntId = userIntId;
});
_addIpcMessageHandler(
  "handleUnspectating",
  ([userIntId, reason]: [number, string]) => {
    if (spectatingIntId === userIntId) {
      spectatingIntId = null;
    }
  },
);
_addIpcMessageHandler("handleSpectated", (spectatorIntId: number) => {
  spectators.add(spectatorIntId);
});
_addIpcMessageHandler("handleUnspectated", (spectatorIntId: number) => {
  spectators.delete(spectatorIntId);
});
_addIpcMessageHandler(
  "handleDisconnect",
  ([code, reason]: [number, string]) => {
    console.warn(`Disconnected (${code}): ${reason}`);
    localStorage.lastDisconnect = String(Date.now());
    setConnectStatus("disconnected");
    wsCapsule!.terminate();
  },
);
_addIpcMessageHandler("exit", () => setConnectStatus("disconnected"));
_addIpcMessageHandler(
  "handleHCaptcha",
  async ([captchaId, siteKey]: [number, string]) => {
    //
  },
);

export function connect(
  device: string,
  server: string = DEFAULT_SERVER,
  vip?: string,
  wsWorker: Worker = wsCapsule!,
): void {
  if (connectStatus !== "initial" && connectStatus !== "disconnected") {
    return;
  }

  sendIpcMessage(wsWorker, "connect", {
    device,
    server,
    vip,
  });
  setConnectStatus("connecting");
}

export function sendServerMessage(
  name: string,
  args?: any,
  event?: Event,
): void {
  const trustedMethods = ["putPixel", "sendLiveChatMsg", "sendPlaceChatMsg"];
  if (
    trustedMethods.includes(name) &&
    (!(event instanceof Event) || !event?.isTrusted)
  ) {
    throw new Error("Trusted method event was invalid");
  }

  sendIpcMessage(wsCapsule!, name, args);
}

export async function makeServerRequest(
  call: string,
  args?: any,
): Promise<any> {
  return await makeIpcRequest(
    wsCapsule as unknown as globalThis.Worker,
    call,
    args,
  );
}

export async function fetchBoard(): Promise<ArrayBuffer | null> {
  const now = Date.now();
  const primary: string = localStorage.board || DEFAULT_BOARD;
  const fallback: string = localStorage.boardFallback || DEFAULT_BOARD_FALLBACK;

  const urlsToTry: string[] = [primary, fallback];
  for (let i = 0; i < urlsToTry.length; i++) {
    const url = urlsToTry[i];
    try {
      const response = await fetch(url + "?v=" + now);
      if (response.ok) {
        if (fetchFailTimeout) {
          clearTimeout(fetchFailTimeout);
        }
        return await response.arrayBuffer();
      } else {
        console.error(
          `Couldn't fetch board: Server responded with ${response.status} ${response.statusText} for: ${url}`,
        );
      }
    } catch (err) {
      console.error(
        `Couldn't fetch board: Network error while fetching board from: ${url}`,
        err,
      );
    }
  }

  // Both primary and fallback failed
  console.error(`Couldn't fetch board: "badresponse"`);

  // Exponential backoff retry
  fetchFailTimeout = setTimeout(fetchBoard, (fetchCooldown *= 2));
  if (fetchCooldown > 8000) {
    clearTimeout(fetchFailTimeout);
    console.error(`Couldn't fetch board: "timeout"`);
  }

  return null;
}
export function setSize(width: number, height: number): void {
  WIDTH = width;
  HEIGHT = height;
  BOARD = new Uint8Array(width * height).fill(255);
}

// Tracking timer that will update onCooldown and placeButton on completion
let cooldownTimeout: ReturnType<typeof setTimeout> | null = null;

export function setPixel(x: number, y: number, colour: number): void {
  const index = (x % WIDTH) + (y % HEIGHT) * WIDTH;
  setPixelI(index, colour);
}

export function setPixelI(index: number, colour: number): void {
  if (!BOARD || !SOCKET_PIXELS) {
    console.error("Could not set pixel: Board or socket pixels was null");
    return;
  }

  BOARD[index] = colour;
  SOCKET_PIXELS[index] = colour;
}

export function sendIpcMessage(target: Worker, call: ipcCallType, data?: any) {
  sharedIpcSendIpcMessage(
    target as unknown as globalThis.Worker,
    call,
    data ?? undefined,
  );
}

export function updateCurrentCanvas() {
  if (!currentCanvas) {
    currentCanvas = createCanvas(WIDTH, HEIGHT);
  }
  const ctx = currentCanvas.getContext("2d");

  const imageData = ctx.getImageData(
    0,
    0,
    currentCanvas.width,
    currentCanvas.height,
  );
  const data = imageData.data;

  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const colour = PALETTE[BOARD![i]];
    const p = i * 4; // each pixel is 4 bytes in the flat array
    data[p] = colour & 0xff;
    data[p + 1] = (colour >> 8) & 0xff;
    data[p + 2] = (colour >> 16) & 0xff;
    data[p + 3] = (colour >> 24) & 0xff;
  }

  ctx.putImageData(imageData, 0, 0);
}

// Event emitter
const rplaceListeners = new Map<string, Set<Function>>();

export function rplaceOn<T extends keyof RplaceEventMap>(
  type: T,
  handler: (...args: RplaceEventMap[T]) => void,
) {
  if (!rplaceListeners.has(type)) {
    rplaceListeners.set(type, new Set());
  }
  rplaceListeners.get(type)!.add(handler);
}

export function rplaceOff<T extends keyof RplaceEventMap>(
  type: T,
  handler: (...args: RplaceEventMap[T]) => void,
) {
  rplaceListeners.get(type)?.delete(handler);
}
