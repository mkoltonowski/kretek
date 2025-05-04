// whisper-queue.ts

import { spawn } from "node:child_process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execAsync = promisify(exec);

export class WhisperBridge {
  private queue: (() => Promise<void>)[] = [];
  private isProcessing = false;

  constructor(
    private readonly modelPath = path.resolve(
      "./lib/whisper.cpp/models/ggml-base.bin",
    ),
    private readonly whisperPath = path.resolve(
      `./lib/whisper.cpp/build/bin/whisper-cli${process.platform === "win32" ? ".exe" : ""}`,
    ),
  ) {}

  public async transcribe(
    pcmPath: string,
    deleteFile: (f: string) => void,
    onSlur: (text: string) => void,
  ): Promise<void> {
    const wavPath = pcmPath.replace(".pcm", ".wav");

    await execAsync(
      `ffmpeg -f s16le -ar 48000 -ac 2 -i "${pcmPath}" "${wavPath}" -y`,
    );

    this.enqueue(async () => {
      const args = ["-m", this.modelPath, "-f", wavPath, "-l", "pl"];
      const p = spawn(this.whisperPath, args);

      p.stdout.on("data", (data) => {
        const text = data.toString();
        onSlur(text);
      });

      p.on("close", (code) => {
        console.log("Whisper exited with code", code);
        deleteFile(pcmPath);
        deleteFile(wavPath);
      });
    });
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
      await task();
    } catch (err) {
      console.error("Whisper task error:", err);
    } finally {
      this.isProcessing = false;
      this.processQueue();
    }
  }
}
