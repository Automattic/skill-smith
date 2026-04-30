#!/usr/bin/env node
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("tsx/esm", pathToFileURL("./"));

const { run } = await import("../src/runner.ts");
const exitCode = await run();
process.exit(exitCode);
