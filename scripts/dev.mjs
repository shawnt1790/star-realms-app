// Runs the shared type watcher, the server and the Vite dev server together.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const procs = [
  ["shared", ["-w", "@sr/shared", "run", "dev"]],
  ["server", ["-w", "@sr/server", "run", "dev"]],
  ["client", ["-w", "@sr/client", "run", "dev"]],
].map(([name, args]) => {
  const child = spawn(npm, args, { stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => console.log(`[${name}] exited with ${code}`));
  return child;
});

function shutdown() {
  for (const p of procs) p.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
