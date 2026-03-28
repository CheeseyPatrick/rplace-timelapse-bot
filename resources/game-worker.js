// Unobfuscated version of game-worker.js from rplace.live (ai generated!)
// From https://server.rplace.live/public/game-worker.js (March 8, 2026)
// You can use the original script, but I've provided an unobfuscated version for ease of use

// ─── Module helpers (ESM/CJS interop) ────────────────────────────────────────

var objectCreate = Object.create;
var { getPrototypeOf, defineProperty, getOwnPropertyNames } = Object;
var hasOwn = Object.prototype.hasOwnProperty;

/**
 * Creates an ES-module-compatible wrapper around a CJS/plain object,
 * exposing all its own properties as enumerable getters and attaching a
 * `default` export when the object is not already an ES module.
 */
var wrapModule = (mod, forceDefault, wrapped) => {
  wrapped = mod != null ? objectCreate(getPrototypeOf(mod)) : {};

  let result =
    forceDefault || !mod || !mod.__esModule
      ? defineProperty(wrapped, "default", { value: mod, enumerable: true })
      : wrapped;

  for (let key of getOwnPropertyNames(mod)) {
    if (!hasOwn.call(result, key)) {
      defineProperty(result, key, {
        get: () => mod[key],
        enumerable: true,
      });
    }
  }
  return result;
};

/** Dynamic `require()` with a Proxy fallback for environments that lack it. */
var dynamicRequire = ((fallback) =>
  typeof require !== "undefined"
    ? require
    : typeof Proxy !== "undefined"
      ? new Proxy(fallback, {
          get: (target, key) =>
            (typeof require !== "undefined" ? require : target)[key],
        })
      : fallback)(function (id) {
  if (typeof require !== "undefined") {
    return require.apply(this, arguments);
  }
  throw Error('Dynamic require of "' + id + '" is not supported');
});

// ─── PublicPromise ─────────────────────────────────────────────────────────────

/**
 * A Promise subclass that exposes `resolve` and `reject` as public methods,
 * making deferred promises easy to create without an executor wrapper.
 */
class PublicPromise extends Promise {
  #resolve = () => {
    throw new Error(
      "PublicPromise resolve invoked before constructor initialisation",
    );
  };
  #reject = () => {
    throw new Error(
      "PublicPromise reject invoked before constructor initialisation",
    );
  };

  constructor(executor = null) {
    let capturedResolve = () => {
      throw new Error(
        "Captured resolve invoked before superclass initialisation",
      );
    };
    let capturedReject = () => {
      throw new Error(
        "Captured reject invoked before superclass initialisation",
      );
    };

    super((resolve, reject) => {
      capturedResolve = resolve;
      capturedReject = reject;
      if (executor) {
        executor(resolve, reject);
      }
    });

    this.#resolve = capturedResolve;
    this.#reject = capturedReject;
  }

  resolve(value) {
    this.#resolve(value);
  }

  reject(reason) {
    this.#reject(reason);
  }

  static deferred() {
    return new PublicPromise();
  }
}

// ─── Environment helpers ───────────────────────────────────────────────────────

/** Pending IPC response handles, keyed by handle ID -> PublicPromise. */
var pendingIpcHandles = new Map();

/** Unwraps an HTMLIFrameElement to its contentWindow; otherwise returns the value as-is. */
function unwrapIframe(target) {
  if (
    target &&
    typeof HTMLIFrameElement !== "undefined" &&
    target instanceof HTMLIFrameElement
  ) {
    return target.contentWindow;
  }
  return target;
}

/** Returns the current environment name: `window.name` in a browser, or `"worker"`. */
function getEnvName() {
  try {
    if (typeof window !== "undefined" && typeof window.name === "string") {
      return window.name;
    }
    return "worker";
  } catch {
    return "worker";
  }
}

/** Returns true when running in a browser Window context. */
function isBrowser() {
  return typeof Window !== "undefined" && typeof window !== "undefined";
}

/** Returns true when `value` is a browser Window instance. */
function isWindow(value) {
  return isBrowser() && value instanceof Window;
}

/** Returns true when running in Node.js. */
function isNodeEnv() {
  return (
    typeof process !== "undefined" &&
    !!process.versions &&
    !!process.versions.node
  );
}

// ─── IPC message validation ────────────────────────────────────────────────────

/**
 * Returns true when `obj` has exactly the four keys of an IpcMessage:
 * { call, data, handle, source }
 */
function isIpcMessage(obj) {
  if (!obj || typeof obj !== "object") return false;

  const required = ["call", "data", "handle", "source"];
  const keys = Object.keys(obj);

  for (let key of required) {
    if (!(key in obj)) return false;
  }
  for (let key of keys) {
    if (!required.includes(key)) return false;
  }
  return true;
}

/**
 * Returns true when `obj` is a structurally valid IpcMessage:
 * non-empty `call` string, finite numeric or undefined `handle`, string `source`.
 */
function isValidIpcMessage(obj) {
  if (!isIpcMessage(obj)) return false;

  if (typeof obj.call !== "string" || obj.call.length === 0) return false;

  if (obj.handle !== undefined) {
    if (
      typeof obj.handle !== "number" ||
      isNaN(obj.handle) ||
      !isFinite(obj.handle)
    ) {
      return false;
    }
  }

  if (typeof obj.source !== "string") return false;

  return true;
}

/**
 * Returns true when `obj` has exactly the four keys of an IpcResult:
 * { data, handle, source, error }
 */
function isIpcResult(obj) {
  if (!obj || typeof obj !== "object") return false;

  const required = ["data", "handle", "source", "error"];
  const keys = Object.keys(obj);

  for (let key of required) {
    if (!(key in obj)) return false;
  }
  for (let key of keys) {
    if (!required.includes(key)) return false;
  }
  return true;
}

/**
 * Returns true when `obj` is a structurally valid IpcResult:
 * exactly one of data/error is set, handle is a finite number, source is a non-empty string.
 */
function isValidIpcResult(obj) {
  if (!isIpcResult(obj)) return false;

  if (obj.data === undefined && obj.error === undefined) return false;
  if (obj.data !== undefined && obj.error !== undefined) return false;

  if (
    typeof obj.handle !== "number" ||
    isNaN(obj.handle) ||
    !isFinite(obj.handle)
  ) {
    return false;
  }

  if (typeof obj.source !== "string" || obj.source.length === 0) return false;

  return true;
}

// ─── IPC transport helpers ─────────────────────────────────────────────────────

/**
 * Posts an IpcResult to `target`. Falls back to Node's `parentPort`
 * or the global `postMessage` when `target` is null.
 */
async function postIpcResult(target = null, result) {
  if (!isValidIpcResult(result)) {
    throw new Error("Invalid IPC result structure");
  }

  if (target) {
    target.postMessage(result);
    return;
  }

  if (isNodeEnv()) {
    try {
      let { parentPort } = await import("worker_threads");
      if (parentPort) {
        parentPort.postMessage(result);
        return;
      } else {
        throw new Error(
          "Invalid postIpcResponse target: No valid method found",
        );
      }
    } catch {}
  }

  if (typeof postMessage === "function") {
    postMessage(result);
  } else {
    throw new Error("Invalid postIpcResponse target: No valid method found");
  }
}

/**
 * Posts a validated IpcMessage to `target`
 * (a Window, any object with postMessage, or the global scope).
 */
function postIpcMessage(target, message) {
  if (!isValidIpcMessage(message)) {
    throw new Error("Invalid IPC message structure");
  }

  if (target && isWindow(target)) {
    target.postMessage(message, { targetOrigin: location.origin });
  } else if (target && typeof target.postMessage === "function") {
    target.postMessage(message);
  } else if (typeof postMessage === "function") {
    postMessage(message);
  } else {
    throw new Error("Invalid postIpcMessage target: No valid method found");
  }
}

/**
 * Builds and dispatches an IpcMessage to `target` for `method` with optional `data`.
 * Unwraps iframes automatically.
 */
function sendIpc(target, method, data = undefined) {
  let resolvedTarget = unwrapIframe(target);
  if (!resolvedTarget) {
    throw new Error("Invalid postMessage target");
  }

  postIpcMessage(resolvedTarget, {
    call: method,
    data: data,
    handle: undefined,
    source: getEnvName(),
  });
}

// ─── IPC method registry ───────────────────────────────────────────────────────

/** Registry of named IPC handler functions, populated at connect time. */
var ipcRegistry = new Map();

/** Registers a named IPC handler function. */
function registerIpcHandler(name, handler) {
  ipcRegistry.set(name, handler);
}

/**
 * Dispatches an incoming MessageEvent or raw IPC object:
 *   - IpcMessage -> calls the registered handler, then posts back an IpcResult.
 *   - IpcResult  -> resolves or rejects the matching pending PublicPromise.
 */
async function handleIncomingIpc(event, sourceOverride = null) {
  if (!event) {
    throw new Error("Received IPC data was null or undefined");
  }

  let ipcData = null;
  let source = sourceOverride;

  if (typeof MessageEvent !== "undefined" && event instanceof MessageEvent) {
    if (!event.isTrusted) {
      throw new Error(
        "Received IPC data was not a trusted instance of type MessageEvent",
      );
    }
    ipcData = event.data;
    source = event.source;
  } else if (isIpcMessage(event)) {
    ipcData = event;
  } else if (isIpcResult(event)) {
    ipcData = event;
  } else {
    throw new Error(
      "Received IPC data was not a valid instance of type MessageEvent or IpcMessage",
    );
  }

  if (!ipcData) {
    throw new Error("Received IPC message was null or undefined");
  }

  if (isIpcMessage(ipcData)) {
    // Dispatch to the registered handler and reply with an IpcResult.
    let result = undefined;
    try {
      let methodName = ipcData.call;

      if (ipcRegistry.has(methodName)) {
        result = await ipcRegistry.get(methodName)(ipcData.data);
      } else {
        // Fall back to a method on the global object.
        let globalCtx;
        if (isBrowser()) {
          globalCtx = window;
        } else if (typeof globalThis !== "undefined") {
          globalCtx = globalThis;
        } else if (typeof self !== "undefined") {
          globalCtx = self;
        } else {
          throw new Error("Could not access global context to call IPC method");
        }

        if (typeof globalCtx[methodName] === "function") {
          result = await globalCtx[methodName](ipcData.data);
        }
      }

      if (ipcData.handle !== undefined && ipcData.handle !== null) {
        await postIpcResult(source, {
          handle: ipcData.handle,
          data: result,
          source: getEnvName(),
          error: undefined,
        });
      }
    } catch (err) {
      console.error("Error executing IPC call '" + ipcData.call + "':", err);

      if (ipcData.handle !== undefined && ipcData.handle !== null) {
        await postIpcResult(source, {
          handle: ipcData.handle,
          error: err instanceof Error ? err.message : String(err),
          source: getEnvName(),
          data: undefined,
        });
      }
    }
  } else if (isIpcResult(ipcData)) {
    // Resolve or reject the matching deferred promise.
    let pending = pendingIpcHandles.get(ipcData.handle);
    if (pending) {
      if (ipcData.error) {
        pending.reject(ipcData.error);
      } else {
        pending.resolve(ipcData.data);
      }
      pendingIpcHandles.delete(ipcData.handle);
    }
  }
}

// ─── Binary codec helpers ──────────────────────────────────────────────────────

var encoder = new TextEncoder();
var decoder = new TextDecoder();

// ─── WebSocket packet handler ──────────────────────────────────────────────────

class PacketHandler {
  #wsSend; // Unbound WebSocket.prototype.send
  #callSend; // Function.prototype.call.bind(call) -- used to invoke #wsSend on #ws
  #ws; // The active WebSocket connection
  #packetTable; // Sparse array: packet-type byte -> handler function
  #linkKeyQueue; // Queue of pending PublicPromises for fetchLinkKey()
  #nameMap; // Map<intId, chatName> -- populated by packet 12
  #selfIntId; // Our own integer user ID, set by packet 11

  // ── Inbound packet handlers ───────────────────────────────────────────────

  /** Packet 0 - Full palette update. */
  #handlePalette(view) {
    if (view.byteLength === 0) {
      console.error(
        "Palette packet length was unexpectedly zero. Potential packet corruption?",
      );
      return;
    }

    let offset = 1;
    let colorCount = view.getUint8(offset++);
    let colors = [];

    for (let i = 0; i < colorCount; i++) {
      colors.push(view.getUint32(offset));
      offset += 4;
    }

    let paletteFlag = 0;
    let activeColorCount = colorCount;

    if (view.byteLength - offset >= 2) {
      paletteFlag = view.getUint8(offset++);
      activeColorCount = view.getUint8(offset++);
    }

    sendIpc(self, "handlePalette", [colors, paletteFlag, activeColorCount]);
  }

  /** Packet 1 - Cooldown info (next placement time + extra value). */
  #handleCooldownInfo(view) {
    let timestamp = new Date(Number(view.getBigUint64(1)));
    let value = view.getUint32(9);
    sendIpc(self, "handleCooldownInfo", [timestamp, value]);
  }

  /** Packet 2 - Incremental canvas change data. */
  #handleChanges(view) {
    let offsetX = view.getUint32(1);
    let offsetY = view.getUint32(5);
    let data = view.buffer.slice(9);
    sendIpc(self, "handleChanges", [offsetX, offsetY, data]);
  }

  /** Packet 3 - Current online user count. */
  #handleOnlineCount(view) {
    let count = view.getUint16(1);
    sendIpc(self, "setOnline", count);
  }

  /** Packet 4 - Cooldown end timestamp. */
  #handleCooldown(view) {
    let cooldownEnd = new Date(Number(view.getBigUint64(1)));
    sendIpc(self, "handleCooldown", cooldownEnd);
  }

  /** Packet 5 - Per-pixel placer info, including placer user ID. */
  #handlePixelPlacersFull(view) {
    let offset = 1;
    let pixels = [];

    while (offset < view.byteLength) {
      let position = view.getUint32(offset);
      offset += 4;
      let colour = view.getUint8(offset);
      offset += 1;
      let placer = view.getUint32(offset);
      offset += 4;
      pixels.push({ position, colour, placer });
    }

    sendIpc(self, "handlePixels", pixels);
  }

  /** Packet 6 - Per-pixel placer info, compact form (no placer user ID). */
  #handlePixelPlacersCompact(view) {
    let offset = 0;
    let pixels = [];

    while (offset < view.byteLength - 2) {
      let position = view.getUint32((offset += 1));
      let colour = view.getUint8((offset += 4));
      pixels.push({ position, colour });
    }

    sendIpc(self, "handlePixels", pixels);
  }

  /** Packet 7 - Server rejected a pixel placement. */
  #handleRejectedPixel(view) {
    let timestamp = new Date(Number(view.getBigUint64(1)));
    let position = view.getUint32(9);
    let colour = view.getUint8(13);
    sendIpc(self, "handleRejectedPixel", [timestamp, position, colour]);
  }

  /** Packet 8 - Canvas locked/unlocked with an optional reason string. */
  #handleCanvasLocked(view) {
    let locked = !!view.getUint8(1);
    let reason = decoder.decode(view.buffer.slice(2));
    sendIpc(self, "setCanvasLocked", [locked, reason]);
  }

  /** Packet 9 - Placer info for a rectangular region. */
  #handlePlacerInfoRegion(view) {
    let position = view.getUint32(1);
    let byte5 = view.getUint8(5);
    let byte6 = view.getUint8(6);
    let data = view.buffer.slice(7);
    sendIpc(self, "handlePlacerInfoRegion", [position, byte5, byte6, data]);
  }

  /** Packet 10 - Canvas dimensions (width x height). */
  #handleCanvasInfo(view) {
    let width = view.getUint32(1);
    let height = view.getUint32(5);
    sendIpc(self, "handleCanvasInfo", [width, height]);
  }

  /** Packet 11 - Server assigns our integer user ID. */
  #handleSetIntId(view) {
    let id = (this.#selfIntId = view.getUint32(1));
    sendIpc(self, "handleSetIntId", id);
  }

  /** Packet 12 - Batch of intId -> chat-name mappings. */
  #handleNameInfo(view) {
    for (let offset = 1; offset < view.byteLength; ) {
      let intId = view.getUint32(offset);
      offset += 4;
      let nameLen = view.getUint8(offset++);
      let name = decoder.decode(view.buffer.slice(offset, (offset += nameLen)));
      this.#nameMap.set(intId, name);

      if (intId === this.#selfIntId) {
        sendIpc(self, "setChatName", name);
      }
    }

    sendIpc(self, "handleNameInfo", this.#nameMap);
  }

  /** Packet 13 - Live chat history batch. */
  #handleLiveChatHistory(view) {
    sendIpc(self, "addLiveChatMessages", this.#parseChatHistory(view));
  }

  /** Packet 14 - Punishment info (mute or ban). */
  #handlePunishment(view) {
    sendIpc(self, "applyPunishment", this.#parsePunishment(view));
  }

  /** Packet 15 - Single incoming chat message (live or place-chat). */
  #handleChatMessage(view) {
    let msg = this.#parseChatMessage(view);

    if (msg.type === "live") {
      sendIpc(self, "addLiveChatMessage", [msg.message, msg.channel]);
    } else {
      sendIpc(self, "addPlaceChatMessage", msg.message);
    }
  }

  /** Packet 17 - A live chat message was deleted. */
  #handleLiveChatDelete(view) {
    sendIpc(self, "handleLiveChatDelete", view.getUint32(1));
  }

  /** Packet 18 - A reaction was added to a live chat message. */
  #handleLiveChatReaction(view) {
    let messageId = view.getUint32(1);
    let userId = view.getUint32(5);
    let emoji = decoder.decode(view.buffer.slice(9));
    sendIpc(self, "handleLiveChatReaction", [messageId, userId, emoji]);
  }

  /** Packet 20 - Text-based CAPTCHA challenge. */
  #handleTextCaptcha(view) {
    let textLen = view.getUint8(1);
    let difficulty = view.getUint8(2);
    let lines = decoder
      .decode(new Uint8Array(view.buffer).slice(3, textLen + 3))
      .split("\n");
    let imageData = new Uint8Array(view.buffer).slice(3 + textLen);
    sendIpc(self, "handleTextCaptcha", [difficulty, lines, imageData]);
  }

  /** Packet 21 - Emoji-based CAPTCHA challenge. */
  #handleEmojiCaptcha(view) {
    let emojiDataLen = view.getUint8(1);
    let emojiCount = view.getUint8(2);
    let emojiList = decoder
      .decode(new Uint8Array(view.buffer).slice(3, emojiDataLen + 3))
      .split("\n");
    let emojiImageData = new Uint8Array(view.buffer).slice(3 + emojiDataLen);
    sendIpc(self, "handleEmojiCaptcha", [
      emojiCount,
      emojiList,
      emojiImageData,
    ]);
  }

  /** Packet 22 - CAPTCHA was solved successfully. */
  #handleCaptchaSuccess(view) {
    sendIpc(self, "handleCaptchaSuccess", undefined);
  }

  /** Packet 23 - Proof-of-work challenge. */
  #handleChallenge(view) {
    let challengeLen = view.getUint32(1);
    let challengeEnd = 5 + challengeLen;
    let challengeB64 = atob(decoder.decode(view.buffer.slice(5, challengeEnd)));
    let extraData = new Uint8Array(view.buffer.slice(challengeEnd));
    sendIpc(self, "handleChallenge", [challengeB64, extraData]);
  }

  /** Packet 24 - Cloudflare Turnstile CAPTCHA challenge. */
  #handleTurnstile(view) {
    let captchaId = view.getUint8(1);
    let siteKey = decoder.decode(view.buffer.slice(2));
    sendIpc(self, "handleTurnstile", [captchaId, siteKey]);
  }

  /** Packet 25 - Turnstile CAPTCHA solved. */
  #handleTurnstileSuccess(view) {
    sendIpc(self, "handleTurnstileSuccess", undefined);
  }

  /** Packet 26 - hCaptcha challenge. */
  #handleHCaptcha(view) {
    let captchaId = view.getUint8(1);
    let siteKey = decoder.decode(view.buffer.slice(2));
    sendIpc(self, "handleHCaptcha", [captchaId, siteKey]);
  }

  /** Packet 27 - hCaptcha solved. */
  #handleHCaptchaSuccess(view) {
    sendIpc(self, "handleHCaptchaSuccess", undefined);
  }

  /** Packet 40 - We started spectating a user. */
  #handleSpectating(view) {
    sendIpc(self, "handleSpectating", view.getUint32(1));
  }

  /** Packet 41 - We stopped spectating a user. */
  #handleUnspectating(view) {
    let userId = view.getUint32(1);
    let reason = decoder.decode(view.buffer.slice(5)) ?? "";
    sendIpc(self, "handleUnspectating", [userId, reason]);
  }

  /** Packet 42 - Someone started spectating us. */
  #handleSpectated(view) {
    sendIpc(self, "handleSpectated", view.getUint32(1));
  }

  /** Packet 43 - Someone stopped spectating us. */
  #handleUnspectated(view) {
    sendIpc(self, "handleUnspectated", view.getUint32(1));
  }

  /** Packet 50 - Client viewport dimensions. */
  #handleClientViewport(view) {
    sendIpc(self, "handleClientViewport", [view.getUint8(1), view.getUint8(2)]);
  }

  /** Packet 51 - Client theme strings (three length-prefixed UTF-8 values). */
  #handleClientTheme(view) {
    let offset = 1;

    let len1 = view.getUint8(offset++);
    let str1 = decoder.decode(view.buffer.slice(offset, offset + len1));
    offset += len1;

    let len2 = view.getUint8(offset++);
    let str2 = decoder.decode(view.buffer.slice(offset, offset + len2));
    offset += len2;

    let len3 = view.getUint8(offset++);
    let str3 = decoder.decode(view.buffer.slice(offset, offset + len3));

    sendIpc(self, "handleClientTheme", [str1, str2, str3]);
  }

  /** Packet 110 - Server's response to a fetchLinkKey request. */
  #handleLinkKeyResponse(view) {
    let queueLen = this.#linkKeyQueue.length;
    if (!queueLen) {
      console.error(
        "Could not resolve link key, no existing link key requests could be found",
      );
      return;
    }

    let instanceId = view.getUint32(1);
    let linkKey = decoder.decode(view.buffer.slice(5));
    this.#linkKeyQueue[queueLen - 1].resolve({ linkKey, instanceId });
  }

  // ── Binary parsers ────────────────────────────────────────────────────────

  /** Parses a type-15 packet into a live or place-chat message object. */
  #parseChatMessage(view) {
    let offset = 1;

    let flagByte = view.getUint8(offset++);
    let messageId = view.getUint32(offset);
    offset += 4;
    let contentLen = view.getUint16(offset);
    offset += 2;
    let content = decoder.decode(
      view.buffer.slice(offset, (offset += contentLen)),
    );
    let senderIntId = view.getUint32(offset);
    offset += 4;
    let senderChatName = this.#nameMap.get(senderIntId) || "#" + senderIntId;

    if (flagByte === 0) {
      // Live chat message
      let sendDate = view.getUint32(offset);
      offset += 4;

      let reactions = new Map();
      let reactionCount = view.getUint8(offset++);

      for (let i = 0; i < reactionCount; i++) {
        let emojiLen = view.getUint8(offset++);
        let emoji = decoder.decode(
          view.buffer.slice(offset, (offset += emojiLen)),
        );
        let reactors = new Set();
        let reactorCount = view.getUint32(offset);
        offset += 4;
        for (let j = 0; j < reactorCount; j++) {
          reactors.add(view.getUint32(offset));
          offset += 4;
        }
        reactions.set(emoji, reactors);
      }

      let channelLen = view.getUint8(offset++);
      let channel = decoder.decode(
        view.buffer.slice(offset, (offset += channelLen)),
      );

      let repliesTo = null;
      if (view.byteLength - offset >= 4) {
        repliesTo = view.getUint32(offset);
      }

      return {
        type: "live",
        message: {
          messageId,
          content,
          senderIntId,
          senderChatName,
          sendDate,
          reactions,
          channel,
          repliesTo,
        },
        channel,
      };
    } else {
      // Place-chat message (content capped at 56 chars)
      let position = view.getUint32(offset);
      content = content.substring(0, 56);
      return {
        type: "place",
        message: {
          positionIndex: position,
          content,
          senderIntId,
          senderChatName,
        },
      };
    }
  }

  /** Parses a type-13 packet into a live chat history object. */
  #parseChatHistory(view) {
    let offset = 1;

    let fromMessageId = view.getUint32(offset);
    offset += 4;

    let countByte = view.getUint8(offset++);
    let count = countByte & 127;
    let before = countByte >> 7 !== 0;

    let channelLen = view.getUint8(offset++);
    let channel = decoder.decode(
      view.buffer.slice(offset, (offset += channelLen)),
    );

    let messages = [];

    while (offset < view.byteLength) {
      let msgStart = offset;
      let msgLenField = view.getUint16(offset);
      offset += 2;

      let msgId = view.getUint32(offset);
      offset += 4;
      let msgContentLen = view.getUint16(offset);
      offset += 2;
      let msgContent = decoder.decode(
        view.buffer.slice(offset, (offset += msgContentLen)),
      );
      let senderIntId = view.getUint32(offset);
      offset += 4;
      let sendDate = view.getUint32(offset);
      offset += 4;

      let reactions = new Map();
      let reactionCount = view.getUint8(offset++);

      for (let i = 0; i < reactionCount; i++) {
        let emojiLen = view.getUint8(offset++);
        let emoji = decoder.decode(
          view.buffer.slice(offset, (offset += emojiLen)),
        );
        let reactors = new Set();
        let reactorCount = view.getUint32(offset);
        offset += 4;
        for (let j = 0; j < reactorCount; j++) {
          reactors.add(view.getUint32(offset, false));
          offset += 4;
        }
        reactions.set(emoji, reactors);
      }

      let msgChannelLen = view.getUint8(offset++);
      let msgChannel = decoder.decode(
        view.buffer.slice(offset, (offset += msgChannelLen)),
      );

      let repliesTo = null;
      let bytesRead = offset - msgStart;
      if (msgLenField - (bytesRead - 2) === 4) {
        repliesTo = view.getUint32(offset);
        offset += 4;
      }

      messages.push({
        messageId: msgId,
        content: msgContent,
        senderIntId,
        senderChatName: "",
        sendDate,
        reactions,
        channel: msgChannel,
        repliesTo,
      });
    }

    return { fromMessageId, count, before, channel, messages };
  }

  /** Parses a type-14 packet into a punishment object. */
  #parsePunishment(view) {
    let offset = 1;

    let state = view.getUint8(offset++);
    let startDate = view.getUint32(offset) * 1000;
    offset += 4;
    let endDate = view.getUint32(offset) * 1000;
    offset += 4;

    let reasonLen = view.getUint8(offset++);
    let reason = decoder.decode(view.buffer.slice(offset, offset + reasonLen));
    offset += reasonLen;

    let appealLen = view.getUint8(offset++);
    let appeal = decoder.decode(view.buffer.slice(offset, offset + appealLen));

    return { state, startDate, endDate, reason, appeal };
  }

  // ── Outbound message senders ──────────────────────────────────────────────

  connect({ device: deviceId, server: serverUrl, vip: vipPolicy = null }) {
    let url = new URL(serverUrl);
    if (vipPolicy !== null) {
      url.searchParams.set("vip", vipPolicy);
    }
    url.searchParams.set("d", deviceId);

    this.#ws = new WebSocket(url);

    this.#ws.addEventListener("open", () => {
      sendIpc(self, "handleConnect");
    });

    this.#ws.addEventListener("message", async (event) => {
      let view = new DataView(await event.data.arrayBuffer());
      let packetType = view.getUint8(0);
      let handler = this.#packetTable[packetType];

      if (handler && typeof handler === "function") {
        handler(view);
      } else {
        console.error("Couldn't find handler for packet", packetType);
      }
    });

    this.#ws.addEventListener("close", async (event) => {
      console.error(event);
      let { code, reason } = event;
      sendIpc(self, "handleDisconnect", [code, reason]);
    });

    registerIpcHandler("chatReact", (data) => this.chatReact(data));
    registerIpcHandler("chatReport", (data) => this.chatReport(data));
    registerIpcHandler("sendCaptchaResult", (data) =>
      this.sendCaptchaResult(data),
    );
    registerIpcHandler("fetchLinkKey", () => this.fetchLinkKey());
    registerIpcHandler("requestLoadChannelPrevious", (data) =>
      this.requestLoadChannelPrevious(data),
    );
    registerIpcHandler("requestPixelPlacers", (data) =>
      this.requestPixelPlacers(data),
    );
    registerIpcHandler("sendLiveChatMsg", (data) => this.sendLiveChatMsg(data));
    registerIpcHandler("sendModAction", (data) => this.sendModAction(data));
    registerIpcHandler("sendPlaceChatMsg", (data) =>
      this.sendPlaceChatMsg(data),
    );
    registerIpcHandler("setName", (data) => this.setName(data));
    registerIpcHandler("putPixel", (data) => this.putPixel(data));
    registerIpcHandler("sendTurnstileResult", (data) =>
      this.sendTurnstileResult(data),
    );
    registerIpcHandler("sendHCaptchaResult", (data) =>
      this.sendHCaptchaResult(data),
    );
    registerIpcHandler("spectateUser", (data) => this.spectateUser(data));
    registerIpcHandler("unspectateUser", () => this.unspectateUser());
  }

  chatReport({ messageId, reason }) {
    let buf = encoder.encode("XXXXX" + reason);
    buf[0] = 14;
    buf[1] = messageId >> 24;
    buf[2] = messageId >> 16;
    buf[3] = messageId >> 8;
    buf[4] = messageId & 0xff;
    this.#callSend(this.#wsSend, this.#ws, buf);
  }

  informAutomatedActivity(activityData) {
    let buf = encoder.encode("" + JSON.stringify(activityData));
    this.#callSend(this.#wsSend, this.#ws, buf);
  }

  chatReact({ messageId, reactKey }) {
    let buf = encoder.encode("XXXXX" + reactKey);
    buf[0] = 18;
    buf[1] = messageId >> 24;
    buf[2] = messageId >> 16;
    buf[3] = messageId >> 8;
    buf[4] = messageId & 0xff;
    this.#callSend(this.#wsSend, this.#ws, buf);
  }

  sendCaptchaResult(captchaResult) {
    this.#callSend(this.#wsSend, this.#ws, encoder.encode("" + captchaResult));
  }

  async fetchLinkKey() {
    let promise = new PublicPromise(null);
    this.#linkKeyQueue.push(promise);
    this.#callSend(this.#wsSend, this.#ws, new Uint8Array([110]));
    return await promise;
  }

  setName(name) {
    if (name.length > 16) return;
    name ||= "anon";
    this.#callSend(this.#wsSend, this.#ws, encoder.encode("\f" + name));
  }

  requestPixelPlacers({ position, width, height }) {
    if (width === 0 || height === 0) return;
    width = Math.min(width, 15);
    height = Math.min(width, 15);

    let view = new DataView(new Uint8Array(6).buffer);
    view.setUint8(0, 9);
    view.setUint32(1, position);
    view.setUint8(5, ((width & 0xf) << 4) | (height & 0xf));
    this.#callSend(this.#wsSend, this.#ws, view);
  }

  putPixel({ position, colour }) {
    let view = new DataView(new Uint8Array(6).buffer);
    view.setUint8(0, 4);
    view.setUint32(1, position);
    view.setUint8(5, colour);
    this.#callSend(this.#wsSend, this.#ws, view);
  }

  sendLiveChatMsg({ message, channel, replyId = null }) {
    let encodedChannel = encoder.encode(channel);
    let encodedMessage = encoder.encode(message);

    let buf = new Uint8Array(
      4 +
        encodedMessage.byteLength +
        1 +
        encodedChannel.byteLength +
        (replyId != null ? 4 : 0),
    );
    let view = new DataView(buf.buffer);
    let offset = 0;

    view.setUint8(offset++, 15);
    view.setUint8(offset++, 0);
    view.setUint16(offset, encodedMessage.byteLength);
    offset += 2;
    buf.set(encodedMessage, offset);
    offset += encodedMessage.byteLength;
    view.setUint8(offset, encodedChannel.byteLength);
    offset += 1;
    buf.set(encodedChannel, offset);
    offset += encodedChannel.byteLength;

    if (replyId != null) {
      view.setUint32(offset, replyId);
    }

    this.#callSend(this.#wsSend, this.#ws, view);
  }

  sendPlaceChatMsg({ message, position }) {
    let encodedMsg = encoder.encode(message);
    let buf = new Uint8Array(4 + encodedMsg.byteLength + 4);
    let view = new DataView(buf.buffer);
    let offset = 0;

    view.setUint8(offset++, 15);
    view.setUint8(offset++, 1);
    view.setUint16(offset, encodedMsg.byteLength);
    offset += 2;
    buf.set(encodedMsg, offset);
    offset += encodedMsg.byteLength;
    view.setUint32(offset, position);

    this.#callSend(this.#wsSend, this.#ws, view);
  }

  requestLoadChannelPrevious({ channel, anchorMsgId = 0, msgCount = 64 }) {
    let encodedChannel = encoder.encode(channel);
    let view = new DataView(
      new Uint8Array(6 + encodedChannel.byteLength).buffer,
    );

    view.setUint8(0, 13);
    view.setUint32(1, anchorMsgId);
    view.setUint8(5, msgCount | 0x80);

    for (let i = 0; i < encodedChannel.byteLength; i++) {
      view.setUint8(6 + i, encodedChannel[i]);
    }

    this.#callSend(this.#wsSend, this.#ws, view.buffer);
  }

  sendModAction(action) {
    let encodedReason = encoder.encode(action.reason);
    let view = null;
    let logMessage = "";
    let payloadStart = 2;

    switch (action.action) {
      case "kick":
        view = new DataView(
          new Uint8Array(6 + encodedReason.byteLength).buffer,
        );
        view.setUint8(0, 90);
        view.setUint8(1, 0);
        view.setUint32(2, action.memberId);
        payloadStart = 6;
        logMessage = `Kicked player ${action.memberId} with reason '${action.reason}'`;
        break;

      case "mute":
      case "ban": {
        let actionCode = action.action === "mute" ? 1 : 2;
        view = new DataView(
          new Uint8Array(10 + encodedReason.byteLength).buffer,
        );
        view.setUint8(0, 90);
        view.setUint8(1, actionCode);
        view.setUint32(2, action.memberId);
        view.setUint32(6, action.duration);
        payloadStart = 10;
        logMessage =
          ["Muted", "Banned"][actionCode - 1] +
          ` player ${action.memberId} for ` +
          `${Math.floor(action.duration / 3600)} hours, ` +
          `${Math.floor((action.duration % 3600) / 60)} minutes, and ` +
          `${action.duration % 60} seconds with reason '${action.reason}'`;
        break;
      }

      case "captcha": {
        view = new DataView(
          new Uint8Array(6 + encodedReason.byteLength).buffer,
        );
        view.setUint8(0, 90);
        view.setUint8(1, 3);
        view.setUint32(2, action.affectsAll ? 0 : action.memberId);
        payloadStart = 6;
        logMessage =
          `Forced captcha for ${action.affectsAll ? "all users" : "user " + action.memberId}` +
          ` with reason '${action.reason}'`;
        break;
      }

      case "delete": {
        view = new DataView(
          new Uint8Array(6 + encodedReason.byteLength).buffer,
        );
        view.setUint8(0, 90);
        view.setUint8(1, 4);
        view.setUint32(2, action.messageId);
        payloadStart = 6;
        logMessage = `Deleted message ${action.messageId} with reason '${action.reason}'`;
        break;
      }

      default:
        console.error(
          "Couldn't send mod action: Invalid action",
          action.action,
        );
        return;
    }

    for (let i = 0; i < encodedReason.byteLength; i++) {
      view.setUint8(payloadStart + i, encodedReason[i]);
    }

    this.#callSend(this.#wsSend, this.#ws, view.buffer);
    return logMessage;
  }

  setPixels({ position, regionWidth, data }) {
    if (typeof position !== "number" || position < 0) {
      throw new Error("Specified position was invalid");
    }
    if (regionWidth > 255) {
      throw new Error("Specified region width out of range");
    }

    let buf = new Uint8Array(6);
    let view = new DataView(buf.buffer);
    view.setUint8(0, 100);
    view.setUint32(1, position);
    view.setUint8(5, regionWidth);
    buf.set(data, 6);

    this.#callSend(this.#wsSend, this.#ws, buf.buffer);
  }

  movePixels({
    sourcePosition,
    regionWidth,
    regionHeight,
    destPosition,
    selectionMask = null,
  }) {
    if (typeof sourcePosition !== "number" || sourcePosition < 0) {
      throw new Error("Specified position was invalid");
    }
    if (
      !regionWidth ||
      regionWidth > 255 ||
      !regionHeight ||
      regionHeight > 255
    ) {
      throw new Error("Specified region width or height out of range");
    }

    let buf = new Uint8Array(
      11 + (selectionMask ? selectionMask.byteLength : 0),
    );
    let view = new DataView(buf.buffer);
    view.setUint8(0, 101);
    view.setUint32(1, sourcePosition);
    view.setUint8(5, regionWidth);
    view.setUint8(6, regionHeight);
    view.setUint32(7, destPosition);

    if (selectionMask) {
      buf.set(selectionMask, 11);
    }

    this.#callSend(this.#wsSend, this.#ws, buf.buffer);
  }

  sendChallengeResult(answer) {
    let buf = new ArrayBuffer(9);
    let view = new DataView(buf);
    view.setUint8(0, 23);
    view.setBigInt64(1, answer);
    this.#callSend(this.#wsSend, this.#ws, buf);
  }

  /** Shared helper for captcha result packets: [opcode, captchaId, ...encodedResult]. */
  #sendCaptchaPacket(captchaId, result, opcode) {
    let encoded = encoder.encode(result);
    let buf = new Uint8Array(2 + encoded.byteLength);
    let view = new DataView(buf.buffer);
    view.setUint8(0, opcode);
    view.setUint8(1, captchaId);
    buf.set(encoded, 2);
    this.#callSend(this.#wsSend, this.#ws, buf);
  }

  sendTurnstileResult({ captchaId, result }) {
    this.#sendCaptchaPacket(captchaId, result, 24);
  }

  sendHCaptchaResult({ captchaId, result }) {
    this.#sendCaptchaPacket(captchaId, result, 25);
  }

  spectateUser(userId) {
    let buf = new ArrayBuffer(5);
    let view = new DataView(buf);
    view.setUint8(0, 40);
    view.setUint32(1, userId);
    this.#callSend(this.#wsSend, this.#ws, buf);
  }

  unspectateUser() {
    this.#callSend(this.#wsSend, this.#ws, new Uint8Array([41]));
  }

  stop() {
    this.#ws?.close();
    close();
  }

  constructor(wsSend, callSend) {
    this.#wsSend = wsSend;
    this.#callSend = callSend;
    this.#ws = null;
    this.#packetTable = {};
    this.#linkKeyQueue = [];
    this.#nameMap = new Map();
    this.#selfIntId = null;

    this.#packetTable[0] = (v) => this.#handlePalette(v);
    this.#packetTable[1] = (v) => this.#handleCooldownInfo(v);
    this.#packetTable[2] = (v) => this.#handleChanges(v);
    this.#packetTable[3] = (v) => this.#handleOnlineCount(v);
    this.#packetTable[4] = (v) => this.#handleCooldown(v);
    this.#packetTable[5] = (v) => this.#handlePixelPlacersFull(v);
    this.#packetTable[6] = (v) => this.#handlePixelPlacersCompact(v);
    this.#packetTable[7] = (v) => this.#handleRejectedPixel(v);
    this.#packetTable[8] = (v) => this.#handleCanvasLocked(v);
    this.#packetTable[9] = (v) => this.#handlePlacerInfoRegion(v);
    this.#packetTable[10] = (v) => this.#handleCanvasInfo(v);
    this.#packetTable[11] = (v) => this.#handleSetIntId(v);
    this.#packetTable[12] = (v) => this.#handleNameInfo(v);
    this.#packetTable[13] = (v) => this.#handleLiveChatHistory(v);
    this.#packetTable[14] = (v) => this.#handlePunishment(v);
    this.#packetTable[15] = (v) => this.#handleChatMessage(v);
    this.#packetTable[17] = (v) => this.#handleLiveChatDelete(v);
    this.#packetTable[18] = (v) => this.#handleLiveChatReaction(v);
    this.#packetTable[20] = (v) => this.#handleTextCaptcha(v);
    this.#packetTable[21] = (v) => this.#handleEmojiCaptcha(v);
    this.#packetTable[22] = (v) => this.#handleCaptchaSuccess(v);
    this.#packetTable[23] = (v) => this.#handleChallenge(v);
    this.#packetTable[24] = (v) => this.#handleTurnstile(v);
    this.#packetTable[25] = (v) => this.#handleTurnstileSuccess(v);
    this.#packetTable[26] = (v) => this.#handleHCaptcha(v);
    this.#packetTable[27] = (v) => this.#handleHCaptchaSuccess(v);
    this.#packetTable[40] = (v) => this.#handleSpectating(v);
    this.#packetTable[41] = (v) => this.#handleUnspectating(v);
    this.#packetTable[42] = (v) => this.#handleSpectated(v);
    this.#packetTable[43] = (v) => this.#handleUnspectated(v);
    this.#packetTable[50] = (v) => this.#handleClientViewport(v);
    this.#packetTable[51] = (v) => this.#handleClientTheme(v);
    this.#packetTable[110] = (v) => this.#handleLinkKeyResponse(v);

    registerIpcHandler("connect", (data) => this.connect(data));
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

new PacketHandler(
  WebSocket.prototype.send,
  Function.prototype.call.bind(Function.prototype.call),
);

self.addEventListener("message", handleIncomingIpc);
