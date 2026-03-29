import {
  Canvas,
  type CanvasRenderingContext2D,
  type Image,
  loadImage,
  registerFont,
} from "canvas";
import { currentCanvas, HEIGHT, online, WIDTH } from "./ipcHandler";
import path from "path";

registerFont(
  path.join(import.meta.dirname, "resources", "RedditSans-Bold.ttf"),
  { family: "Reddit Sans" },
);

export const frames: { time: number; frame: Buffer }[] = [];

function addPlayerCount(ctx: CanvasRenderingContext2D) {
  const scale = 0.5;
  const margin = scale * 10;
  const panelWidth = scale * 84;
  const panelHeight = scale * 50;

  const startWidth = WIDTH - panelWidth - margin;
  const startHeight = margin;

  ctx.drawImage(
    playerCountImage!,
    startWidth,
    startHeight,
    panelWidth,
    panelHeight,
  );

  ctx.font = `bold ${Math.floor(scale * 28)}px "Reddit Sans"`;
  ctx.fillStyle = "white";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(
    String(online),
    startWidth + scale * 8,
    startHeight + panelHeight / 2,
  );
}

function addTime(ctx: CanvasRenderingContext2D, date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(fmt.map(({ type, value }) => [type, value]));
  const text = `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute}:${p.second}`;

  ctx.font = `bold 14px "Reddit Sans"`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";

  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.strokeText(text, 4, HEIGHT - 4);

  ctx.fillStyle = "yellow";
  ctx.fillText(text, 4, HEIGHT - 4);
}

export function makeFrame(
  playerCount: boolean = true,
  showTime: boolean = true,
) {
  if (currentCanvas) {
    const ctx = currentCanvas.getContext("2d");
    if (playerCount) addPlayerCount(ctx);
    if (showTime) {
      const date = new Date();
      date.setMilliseconds(0);

      addTime(ctx, date);
    }

    return currentCanvas;
  } else {
    return null;
  }
}

export function generateFrame() {
  if (currentCanvas) {
    const date = new Date();
    date.setMilliseconds(0);

    const frame = makeFrame(true, true);

    // @ts-expect-error - frame is not gonna be null but the opps (typescript) wont let me put a !
    frames.push({ time: date.getTime(), frame: frame.toBuffer("raw") });

    if (frames.length > 35) {
      frames.splice(0, frames.length - 35);
    }
  }
}

let playerCountImage: Image | null = null;

let started = 0;

export async function startFrameGenerator() {
  if (started === 1) return;
  started = 1;
  playerCountImage = await loadImage(
    path.join(import.meta.dirname, "resources", "playerCount.png"),
  );

  setInterval(generateFrame, 1000);
}
