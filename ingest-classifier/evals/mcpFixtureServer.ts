import { startClassifierStdio } from "../src/mcp/stdio.ts";
import { AdaptiveFixtureModelClient } from "./adaptiveFixtureModel.ts";

const root = process.argv[2];
if (!root) throw new Error("Fixture server requires a temporary library root.");
startClassifierStdio({ root, model: new AdaptiveFixtureModelClient() });
