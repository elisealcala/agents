import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

type Message = Parameters<StdioServerTransport["send"]>[0];
type RequestId = string | number;

/** Keep the wire open until accepted tool calls have written their responses. */
export class DrainingStdioTransport extends StdioServerTransport {
  private readonly pending = new Map<
    RequestId,
    { done: Promise<void>; finish(): void }
  >();

  override async start(): Promise<void> {
    const dispatch = this.onmessage;
    this.onmessage = (message) => {
      if (
        "method" in message &&
        message.method === "tools/call" &&
        "id" in message
      ) {
        let finish!: () => void;
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        this.pending.set(message.id, { done, finish });
      }
      if ("method" in message && message.method === "notifications/cancelled") {
        const id = message.params?.requestId;
        if (typeof id === "string" || typeof id === "number") this.finish(id);
      }
      dispatch?.(message);
    };
    await super.start();
  }

  override async send(message: Message): Promise<void> {
    try {
      await super.send(message);
    } finally {
      if (
        "id" in message &&
        !("method" in message) &&
        message.id !== undefined
      ) {
        this.finish(message.id);
      }
    }
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending.values()].map(({ done }) => done));
  }

  override async close(): Promise<void> {
    for (const id of this.pending.keys()) this.finish(id);
    await super.close();
  }

  private finish(id: RequestId): void {
    this.pending.get(id)?.finish();
    this.pending.delete(id);
  }
}
