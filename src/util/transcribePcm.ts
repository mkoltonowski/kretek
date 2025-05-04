import { exec } from "node:child_process";
import * as path from "node:path";

export async function transcribePcm(pcmPath: string): Promise<string> {
  const wavPath = pcmPath.replace(".pcm", ".wav");
  const whisperPath = path.resolve("./lib/whisper.cpp/build/bin/main.exe");
  console.log(`${whisperPath}`);
  const modelPath = path.resolve("./lib/whisper.cpp/models/ggml-base.bin");

  await new Promise<void>((resolve, reject) => {
    const cmd = `ffmpeg -f s16le -ar 48000 -ac 2 -i "${pcmPath}" "${wavPath}" -y`;
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });

  return new Promise<string>((resolve, reject) => {
    const cmd = `"${whisperPath}" -m "${modelPath}" -f "${wavPath}" -l pl`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(stderr);
      resolve(stdout);
    });
  });
}
