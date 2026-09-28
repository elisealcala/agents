/**
 * An MCP server started with the fixture model instead of a real provider.
 *
 * Launched as a child process by the MCP worker evaluation so the protocol is
 * exercised over real stdio without any provider credentials.
 */
import { startClassifierStdio } from "../src/mcp/stdio.ts";
import { AdaptiveFixtureModelClient } from "./adaptive-fixture-model.ts";

const root = process.argv[2];
if (!root) throw new Error("Fixture server requires a temporary library root.");
startClassifierStdio({ root, model: new AdaptiveFixtureModelClient() });
