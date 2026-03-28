import { spawn } from "child_process";
import { frames } from "./frameGenerator";
import { HEIGHT, PALETTE, WIDTH } from "./ipcHandler";
import { cpus, tmpdir } from "os";
import { join } from "path";
import { open, unlink, readFile, writeFile } from "fs/promises";
import { createCanvas } from "canvas";
import { CheeseyFile, sendFiles } from "./discordBot";

export function getPixelFormat() {
  const buffer = new ArrayBuffer(4);
  new Uint32Array(buffer)[0] = 0x01020304;
  const isBigEndian = new Uint8Array(buffer)[0] === 0x01;
  return isBigEndian ? "argb" : "bgra";
}

const pixelFormat = getPixelFormat();

export async function writeWithDrain(
  stdin: NodeJS.WritableStream,
  data: Buffer,
): Promise<void> {
  const ok = stdin.write(data);
  if (!ok) {
    await new Promise<void>((resolve) => stdin.once("drain", resolve));
  }
}

export function encodeFramesToWebM(
  framesArray:
    | {
        time: number;
        frame: Buffer<ArrayBufferLike>;
      }[]
    | null = null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const t = performance.now();

    let last60: {
      time: number;
      frame: Buffer<ArrayBufferLike>;
    }[] = [];
    if (!framesArray) {
      last60 = frames.slice(-60);
    } else {
      last60 = framesArray;
    }
    if (last60.length === 0) return reject(new Error("No frames available"));

    const tmpFile = join(tmpdir(), `timelapse_${Date.now()}.webm`);

    const fpsMultiplier = 10;

    const ffmpeg = spawn("ffmpeg", [
      "-f",
      "rawvideo",
      "-pixel_format",
      pixelFormat,
      "-video_size",
      `${WIDTH}x${HEIGHT}`,
      "-framerate",
      "1",
      "-i",
      "pipe:0",
      "-r",
      String(fpsMultiplier),
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
      "-force_key_frames",
      `expr:eq(n,${0 * fpsMultiplier})+eq(n,${15 * fpsMultiplier})+eq(n,${30 * fpsMultiplier})+eq(n,${45 * fpsMultiplier})`,
      "-f",
      "webm",
      tmpFile,
    ]);

    ffmpeg.stderr.on("data", (data: Buffer) => {});
    ffmpeg.on("error", reject);
    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      try {
        const buffer = await readFile(tmpFile);
        console.log(
          `encodeFramesToWebM took ${(performance.now() - t).toFixed(1)}ms`,
        );
        resolve(buffer);
      } catch (err) {
        reject(err);
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    });

    (async () => {
      const writeTime = performance.now();
      for (const { frame } of last60) {
        await writeWithDrain(ffmpeg.stdin, frame);
      }
      console.log(
        `piping encodeFramesToWebM took ${(performance.now() - writeTime).toFixed(1)}ms`,
      );
      ffmpeg.stdin.end();
    })().catch(reject);
  });
}

async function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    proc.stderr.on("data", () => {});
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`${cmd} exited with code ${code}`));
      else resolve();
    });
  });
}

export async function encodeFramesToGif(
  framesArray:
    | {
        time: number;
        frame: Buffer<ArrayBufferLike>;
      }[]
    | null = null,
): Promise<Buffer> {
  const t = performance.now();

  let last60: {
    time: number;
    frame: Buffer<ArrayBufferLike>;
  }[] = [];
  if (!framesArray) {
    last60 = frames.slice(-60);
  } else {
    last60 = framesArray;
  }
  if (last60.length === 0) throw new Error("No frames available");

  const ts = Date.now();
  const tmpRaw = join(tmpdir(), `timelapse_${ts}.raw`);
  const tmpPalette = join(tmpdir(), `timelapse_${ts}_palette.png`);
  const tmpGif = join(tmpdir(), `timelapse_${ts}.gif`);

  try {
    const paletteCanvas = createCanvas(256, 1);
    const ctx = paletteCanvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, 256, 1);
    const data = imageData.data;

    for (let i = 0; i < PALETTE.length && i < 256; i++) {
      const colour = PALETTE[i];
      const p = i * 4;
      data[p] = colour & 0xff;
      data[p + 1] = (colour >> 8) & 0xff;
      data[p + 2] = (colour >> 16) & 0xff;
      data[p + 3] = 0xff;
    }

    ctx.putImageData(imageData, 0, 0);
    await writeFile(tmpPalette, paletteCanvas.toBuffer("image/png"));

    const fileHandle = await open(tmpRaw, "w");
    try {
      for (const { frame } of last60) {
        await fileHandle.write(frame);
      }
    } finally {
      await fileHandle.close();
    }

    await spawnAsync("ffmpeg", [
      "-f",
      "rawvideo",
      "-pixel_format",
      pixelFormat,
      "-video_size",
      `${WIDTH}x${HEIGHT}`,
      "-framerate",
      "1",
      "-i",
      tmpRaw,
      "-i",
      tmpPalette,
      "-lavfi",
      "fps=10[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
      "-loop",
      "0",
      "-y",
      tmpGif,
    ]);

    console.log(
      `encodeFramesToGif took ${(performance.now() - t).toFixed(1)}ms`,
    );
    return await readFile(tmpGif);
  } finally {
    await Promise.all([
      unlink(tmpRaw).catch(() => {}),
      unlink(tmpPalette).catch(() => {}),
      unlink(tmpGif).catch(() => {}),
    ]);
  }
}

export function encodeFramesToAvi(
  framesArray:
    | {
        time: number;
        frame: Buffer<ArrayBufferLike>;
      }[]
    | null = null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const t = performance.now();

    let last60: {
      time: number;
      frame: Buffer<ArrayBufferLike>;
    }[] = [];
    if (!framesArray) {
      last60 = frames.slice(-60);
    } else {
      last60 = framesArray;
    }
    if (last60.length === 0) return reject(new Error("No frames available"));

    const tmpFile = join(tmpdir(), `timelapse_${Date.now()}.webm`);

    const fpsMultiplier = 1;

    const ffmpeg = spawn("ffmpeg", [
      "-f",
      "rawvideo",
      "-pixel_format",
      pixelFormat,
      "-video_size",
      `${WIDTH}x${HEIGHT}`,
      "-framerate",
      "1",
      "-i",
      "pipe:0",
      "-r",
      String(fpsMultiplier),
      "-c:v",
      "ffv1",
      "-level",
      "3",
      "-coder",
      "1",
      "-context",
      "1",
      "-g",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "avi",
      tmpFile,
    ]);

    ffmpeg.stderr.on("data", (data: Buffer) => {});
    ffmpeg.on("error", reject);
    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      try {
        const buffer = await readFile(tmpFile);
        console.log(
          `encodeFramesToAvi took ${(performance.now() - t).toFixed(1)}ms`,
        );
        resolve(buffer);
      } catch (err) {
        reject(err);
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    });

    (async () => {
      const writeTime = performance.now();
      for (const { frame } of last60) {
        await writeWithDrain(ffmpeg.stdin, frame);
      }
      console.log(
        `piping encodeFramesToAvi took ${(performance.now() - writeTime).toFixed(1)}ms`,
      );
      ffmpeg.stdin.end();
    })().catch(reject);
  });
}

export async function makeTimelapseAndUpload() {
  console.log("Making timelapse...");
  const snapshot = frames.slice(-60);
  const video = await encodeFramesToWebM(snapshot);
  await sendFiles("#live", [
    CheeseyFile.from(video, "webm").toDiscordAttachment(),
  ]);
}
