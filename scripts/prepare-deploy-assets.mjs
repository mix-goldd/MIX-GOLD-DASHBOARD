import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve("dist/public");
const nextStaticDir = path.resolve(".next/static");
const publicDir = path.resolve("public");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await cp(nextStaticDir, path.join(outputDir, "_next/static"), {
  recursive: true,
  force: true,
});

try {
  await cp(publicDir, outputDir, { recursive: true, force: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await writeFile(
  path.join(outputDir, "deploy-assets.json"),
  JSON.stringify({ generatedBy: "nextjs", generatedAt: new Date().toISOString() })
);

await writeFile(
  path.resolve("dist/index.js"),
  `process.env.NODE_ENV = "production";
const { spawn } = require("node:child_process");
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "start", "-p", process.env.PORT || "3000"], { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
`
);
