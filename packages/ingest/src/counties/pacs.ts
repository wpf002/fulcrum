/**
 * PACS / TrueAutomation appraisal-export reader.
 *
 * The "Legacy 8.0.x" fixed-width property export used by many Texas CADs
 * (Travis/TCAD, and others). deflate64 zips can't be read by Node's zlib, so
 * we stream via `unzip -p`. Yields normalized records (the field names in
 * layout.ts) that the ingest core consumes. A different vendor's format is a
 * sibling reader producing the same shape.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { PROP_FIELDS, parseLine, type PropRecord } from "../layout.js";

export interface FormatReader {
  /** Stream real-property records, deduped by property id. */
  streamRecords(zipPath: string, member: string): AsyncGenerator<PropRecord>;
}

export const pacsReader: FormatReader = {
  async *streamRecords(zipPath, member) {
    const proc = spawn("unzip", ["-p", zipPath, member], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
    const seen = new Set<string>();
    try {
      for await (const line of rl) {
        const rec = parseLine(line, PROP_FIELDS);
        if (rec.propTypeCd !== "R") continue; // real property only
        if (seen.has(rec.propId)) continue; // partial-owner duplicate rows
        seen.add(rec.propId);
        yield rec;
      }
    } finally {
      // early break (e.g. --limit): stop decompressing the rest of the export
      rl.close();
      proc.kill("SIGTERM");
    }
  },
};

export const READERS = { pacs: pacsReader } as const;
