import { exec, spawn } from "node:child_process";
import * as path from "node:path";

export async function transcribePcm(
  pcmPath: string,
  deleteFile: (f: string) => void,
  onSlur: (t: string) => void,
): Promise<string> {
  const isWindows = process.platform === "win32";

  const wavPath = pcmPath.replace(".pcm", ".wav");
  const whisperPath = path.resolve(
    `./lib/whisper.cpp/build/bin/whisper-cli${isWindows ? ".exe" : ""}`,
  );

  const modelPath = path.resolve("./lib/whisper.cpp/models/ggml-small.bin");

  await new Promise<void>((resolve, reject) => {
    const cmd = `ffmpeg -f s16le -ar 48000 -ac 2 -i "${pcmPath}" "${wavPath}" -y`;
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });

  const p = spawn(whisperPath, ["-m", modelPath, "-f", wavPath, "-l", "pl"]);
  p.stdout.on("data", (data) => {
    console.log(data.toString());
    onSlur(data.toString());
  });
  p.stderr.on("data", (data) => console.error("ERR:", data.toString()));
  p.on("close", (code) => {
    console.log("Whisper exited with code", code);
    deleteFile(pcmPath);
    deleteFile(wavPath);
  });
  return whisperPath;
}
