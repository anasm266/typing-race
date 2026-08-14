/**
 * The worker and web client each keep their own copy of protocol.ts so
 * neither package depends on the other. They must stay byte-identical
 * apart from the "keep in sync" pointer in the header.
 */
import { readFile } from "node:fs/promises";

const FILES = ["worker/src/protocol.ts", "web/src/lib/protocol.ts"];

function normalize(source) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/^ \* Keep this file in sync with .*$/m, "");
}

const [worker, web] = await Promise.all(
  FILES.map((path) => readFile(path, "utf8"))
);

if (normalize(worker) !== normalize(web)) {
  console.error(
    `protocol drift: ${FILES[0]} and ${FILES[1]} differ.\n` +
      `Copy one over the other (keeping each header pointer) and re-run.`
  );
  process.exit(1);
}

console.log("protocol copies are in sync");
