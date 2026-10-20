// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useGuiChat } from "./useGuiChat";
import type { GuiChatOptions, GuiChatRuntime } from "./types";

const peers = vi.hoisted(() => [] as Array<{ calls: string[]; close: ReturnType<typeof vi.fn> }>);
vi.mock("@/lib/gatewayClient", () => ({ GatewayClient: class {
  connectionState = "idle";
  calls: string[] = [];
  close = vi.fn(() => { this.connectionState = "closed"; });
  constructor() { peers.push(this); }
  async connect() { this.calls.push("connect"); this.connectionState = "open"; }
  onAny() { return () => {}; }
  onRequest() { return () => {}; }
  onState() { return () => {}; }
  sessionReplayBarrier() { return undefined; }
  async request(method: string, params: Record<string, unknown>) {
    this.calls.push(method);
    if (method === "runtime.describe") throw Object.assign(new Error("legacy"), { code: -32601 });
    if (method === "session.create") return { session_id: `live-${params.profile}`, stored_session_id: `stored-${params.profile}`, messages: [], info: { profile_name: params.profile }, message_count: 0 };
    throw new Error(method);
  }
} }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { peers.length = 0; });

it("keeps one runtime across hidden route and StrictMode, closes old profile, and allocates nothing for a never-active route", async () => {
  const node = document.createElement("div"); const root = createRoot(node);
  let runtime: GuiChatRuntime | undefined;
  const View = (props: GuiChatOptions) => { runtime = useGuiChat(props); return null; };
  const render = async (props: GuiChatOptions) => { await act(async () => { root.render(createElement(StrictMode, null, createElement(View, props))); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  await render({ profile: "one", isActive: false });
  expect(peers.flatMap(peer => peer.calls)).toEqual([]);
  await render({ profile: "one", isActive: true });
  expect(peers.flatMap(peer => peer.calls).filter(method => method === "session.create")).toHaveLength(1);
  expect(runtime?.sessionId).toBe("live-one");
  const live = peers.find(peer => peer.calls.includes("session.create"))!;
  await render({ profile: "one", isActive: false });
  expect(live.close).not.toHaveBeenCalled();
  await render({ profile: "one", isActive: true });
  expect(live.calls.filter(method => method === "session.create")).toHaveLength(1);
  await render({ profile: "two", isActive: true });
  expect(live.close).toHaveBeenCalledTimes(1);
  expect(runtime?.sessionId).toBe("live-two");
  await act(async () => { root.unmount(); await Promise.resolve(); });
  expect(peers.filter(peer => peer.calls.includes("session.create")).every(peer => peer.close.mock.calls.length === 1)).toBe(true);
});
