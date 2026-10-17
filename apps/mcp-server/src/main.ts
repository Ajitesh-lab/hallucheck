import { startMcp } from "./index.js";
await startMcp(process.argv[2] ?? process.cwd());
