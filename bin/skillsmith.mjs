#!/usr/bin/env node
import "tsx/esm";

const { run } = await import("../src/runner.ts");
process.exit(await run());
