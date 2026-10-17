import { benchmark } from "./benchmark.js";
console.log(
  JSON.stringify(await benchmark(process.argv[2] ?? process.cwd()), null, 2),
);
