/**
 * Smoke test: spawn the MCP server over stdio via a real MCP client, list the
 * tools, and call each one against the live API. Proves the server speaks MCP
 * and the tools work end to end.
 *
 * Usage: FULCRUM_API_URL=http://localhost:3011 tsx src/smoke.ts <agentId> <propertyId>
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const [agentId, propertyId] = process.argv.slice(2);

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", new URL("./server.ts", import.meta.url).pathname],
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));

  if (propertyId) {
    const r = await client.callTool({ name: "fulcrum_score", arguments: { propertyId } });
    console.log("\n== fulcrum_score ==\n" + (r.content as { text: string }[])[0].text);
  }
  if (agentId) {
    const r = await client.callTool({ name: "fulcrum_match", arguments: { agentId, limit: 3 } });
    console.log("\n== fulcrum_match ==\n" + (r.content as { text: string }[])[0].text);
  }
  const tr = await client.callTool({ name: "fulcrum_track_record", arguments: {} });
  console.log("\n== fulcrum_track_record ==\n" + (tr.content as { text: string }[])[0].text);

  await client.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
