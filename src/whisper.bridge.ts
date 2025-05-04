// whisper-queue.ts

import { spawn } from "node:child_process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execAsync = promisify(exec);

export class WhisperBridge {
  public queue: (() => Promise<void>)[] = [];
  private isProcessing = false;
  private readonly model;
  private readonly modelPath;

  constructor(
    model: string,
    private readonly whisperPath = path.resolve(
      `./lib/whisper.cpp/build/bin/whisper-cli${process.platform === "win32" ? ".exe" : ""}`,
    ),
  ) {
    console.log(model);
    this.model = model;
    this.modelPath = path.resolve(`./lib/whisper.cpp/models/ggml-${model}.bin`);
  }

  public async transcribe(
    pcmPath: string,
    deleteFile: (f: string) => void,
    onSlur: (text: string) => void,
    onLog: (text: string) => void,
  ): Promise<void> {
    const wavPath = pcmPath.replace(".pcm", ".wav");

    await execAsync(
      `ffmpeg -f s16le -ar 48000 -ac 2 -i "${pcmPath}" "${wavPath}" -y`,
    );

    this.enqueue(
      () =>
        new Promise<void>((resolve) => {
          const args = ["-m", this.modelPath, "-f", wavPath, "-l", "pl"];
          const p = spawn(this.whisperPath, args);

          p.stdout.on("data", (data) => {
            const text = data.toString();
            console.log(text);
            onSlur(text);
            onLog(text);
          });

          p.stderr.on("data", (data) => {
            const text = data.toString();
            console.error(text);
          });

          p.on("close", (code) => {
            console.log("Whisper exited with code", code);
            deleteFile(pcmPath);
            deleteFile(wavPath);
            resolve();
          });
        }),
    );
  }

  private enqueue(task: () => Promise<void>) {
    this.queue.push(task);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const task = this.queue.shift();
    if (!task) return;

    try {
      console.error("Whisper task start");
      await task();
    } catch (err) {
      console.error("Whisper task error:", err);
    } finally {
      this.isProcessing = false;
      console.error("Whisper task done");
      this.processQueue();
    }
  }
}
