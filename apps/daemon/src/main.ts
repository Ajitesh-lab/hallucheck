import { Engine } from "../../../packages/core/src/index.js";
import { serve } from "./index.js";
const root = process.argv[2] ?? process.cwd();
try {
  const engine = await Engine.open(root);
  const daemon = await serve(engine);
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => void daemon.close());
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
