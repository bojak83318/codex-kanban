import { type IncomingMessage, type ServerResponse } from "node:http";
import { InMemoryKanbanStore } from "./store.js";
export interface AppOptions {
    store?: InMemoryKanbanStore;
}
export declare function createApp(options?: AppOptions): {
    server: import("http").Server<typeof IncomingMessage, typeof ServerResponse>;
    store: InMemoryKanbanStore;
};
