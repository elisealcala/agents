import type { Provider } from "../config.ts";

export type ModelClient = {
  provider: Provider;
  model: string;
  complete(prompt: string): Promise<string>;
};
