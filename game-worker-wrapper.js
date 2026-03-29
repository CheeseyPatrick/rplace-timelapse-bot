import { parentPort } from "worker_threads";
import { WebSocket } from "ws";
import { SocksProxyAgent } from "socks-proxy-agent";

// We need to patch some things to make our node environment act like the normal browser environment that the worker would normally be in

// Patch Buffer to support .arrayBuffer() like a Blob
Buffer.prototype.arrayBuffer = function () {
  return Promise.resolve(
    this.buffer.slice(this.byteOffset, this.byteOffset + this.byteLength),
  );
};

// You can use a proxy if you set the SOCKS5_PROXY environment variable
const agent = process.env.SOCKS5_PROXY
  ? new SocksProxyAgent(process.env.SOCKS5_PROXY)
  : undefined;

// Polyfill browser WebSocket with required headers
const OriginalWebSocket = WebSocket;
globalThis.WebSocket = class extends OriginalWebSocket {
  constructor(url, protocols) {
    super(url, protocols, {
      agent,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Origin: "https://rplace.live",
      },
    });
  }
};

// Polyfill browser globals
globalThis.self = {
  addEventListener: (type, fn) => {
    if (type === "message") {
      parentPort.on("message", (data) => fn(data));
    }
  },
  postMessage: (data) => parentPort.postMessage(data),
};
globalThis.window = globalThis.self;
globalThis.postMessage = (data) => parentPort.postMessage(data);

await import("./resources/game-worker.js");
