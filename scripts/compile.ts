import { spawnSync } from "node:child_process";

type PlatformTarget = "linux" | "macos" | "windows";

const TARGETS: Record<PlatformTarget, { outfile: string; target: string }> = {
  linux: {
    outfile: "./dist/nexagent-linux-x64",
    target: "bun-linux-x64",
  },
  macos: {
    outfile: "./dist/nexagent-darwin-arm64",
    target: "bun-darwin-arm64",
  },
  windows: {
    outfile: "./dist/nexagent-windows-x64.exe",
    target: "bun-windows-x64",
  },
};

const rawArgs = process.argv.slice(2);
const runtimeArgs = rawArgs.filter((arg) => arg.startsWith("--"));
const targetArgs = rawArgs.filter((arg) => !arg.startsWith("--"));
const targets = resolveTargets(targetArgs);

if (runtimeArgs.length > 0) {
  console.log(`compile: ignoring runtime arg(s) ${runtimeArgs.join(" ")}; pass them when running the built binary`);
}

for (const target of targets) {
  const config = TARGETS[target];
  const result = spawnSync("bun", [
    "build",
    "./src/cli.ts",
    "--compile",
    "--outfile",
    config.outfile,
    `--target=${config.target}`,
  ], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveTargets(args: string[]): PlatformTarget[] {
  if (args.length === 0 || args.includes("all")) {
    return ["linux", "macos", "windows"];
  }

  const targets = new Set<PlatformTarget>();
  for (const arg of args) {
    const normalized = arg.toLowerCase();
    if (normalized.includes("linux")) {
      targets.add("linux");
      continue;
    }
    if (normalized.includes("macos") || normalized.includes("darwin")) {
      targets.add("macos");
      continue;
    }
    if (normalized.includes("windows") || normalized.includes("win32")) {
      targets.add("windows");
      continue;
    }
    if (normalized === "dev") {
      continue;
    }
    console.error(`compile: unknown target "${arg}"`);
    console.error("compile: use linux, macos, windows, dev:linux, linux:dev, or all");
    process.exit(1);
  }

  return targets.size > 0 ? [...targets] : ["linux"];
}
