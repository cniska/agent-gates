#!/usr/bin/env node
const { spawn } = require("node:child_process");

const manifest = require("../package.json");
const supported = Object.keys(manifest.optionalDependencies);
const platformPackage = `@cniska/agent-gates-${process.platform}-${process.arch}`;

function refuse(code, message, resolve) {
  const error = { kind: "refusal", code, message, meta: {}, resolve };
  process.stderr.write(`${JSON.stringify({ command: "agent-gates", ok: false, error })}\n`);
  process.exit(1);
}

if (!supported.includes(platformPackage)) {
  refuse(
    "no_build_for_platform",
    `agent-gates ships no build for ${process.platform}-${process.arch}, only ${supported.join(" and ")}`,
    "build agent-gates from source with Bun, as its README says",
  );
}

let binary;
try {
  binary = require.resolve(`${platformPackage}/agent-gates`);
} catch {
  refuse(
    "platform_package_missing",
    `${platformPackage} is not installed beside @cniska/agent-gates`,
    "reinstall @cniska/agent-gates with optional dependencies enabled",
  );
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  refuse("binary_failed", `${binary} could not start: ${error.message}`, "reinstall @cniska/agent-gates");
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
