import type { ConnectionState, GatewayClient } from "@/lib/gatewayClient";

export interface GuiChatMessage { id: string; role: "user" | "assistant" | "system"; text: string; reasoning?: string }
export interface GuiChatTool { id: string; name: string; status: string; args?: unknown; result?: unknown }
export interface GuiChatPendingRequest { id: string; method: string; params: Record<string, unknown> }
export interface GuiChatOptions { profile?: string; resumeId?: string | null; workspaceCwd?: string; resetKey?: number; isActive?: boolean }
export interface GuiChatState {
  sessionId: string | null; storedSessionId: string | null; title: string; model: string; provider: string;
  reasoningEffort: string; supportsReasoning: boolean; messages: GuiChatMessage[]; tools: GuiChatTool[];
  pendingRequests: GuiChatPendingRequest[]; busy: boolean; connectionState: ConnectionState; error: string | null;
}
export interface GuiChatModelResult { confirm_required?: boolean; confirm_message?: string; warning?: string }
export interface GuiChatRuntime extends GuiChatState {
  gateway: GatewayClient;
  submit: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  reconnect: () => Promise<void>;
  setModel: (args: { provider: string; model: string; confirmExpensiveModel?: boolean }) => Promise<GuiChatModelResult | void>;
  setReasoning: (effort: string) => Promise<void>;
  respond: (id: string, result: unknown) => Promise<void>;
  upload: (file: File) => Promise<void>;
}
