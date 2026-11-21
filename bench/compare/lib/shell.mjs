import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export function run(cmd, args) {
  return exec(cmd, args, { windowsHide: true, maxBuffer: 1 << 24 });
}
