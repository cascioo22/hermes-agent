import { useEffect, useMemo, useSyncExternalStore } from "react";
import { GatewayClient } from "@/lib/gatewayClient";
import { GuiChatController } from "./controller";
import type { GuiChatOptions, GuiChatRuntime } from "./types";

/** One authenticated socket/session per mounted profile/conversation; never a PTY or sidecar. */
export function useGuiChat(options: GuiChatOptions): GuiChatRuntime {
  const { profile = "default", resumeId = null, workspaceCwd, resetKey = 0, isActive = true } = options;
  const runtime = useMemo(() => {
    const gateway = new GatewayClient();
    return { gateway, controller: new GuiChatController(gateway, { profile, resumeId, workspaceCwd, resetKey }), leases: 0 };
  }, [profile, resumeId, workspaceCwd, resetKey]);
  const { controller, gateway } = runtime;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    runtime.leases += 1;
    return () => {
      runtime.leases -= 1;
      // React StrictMode re-runs effects synchronously. A real profile change/unmount retires
      // this controller before its next awaited authentication/creation continuation can act.
      queueMicrotask(() => { if (runtime.leases === 0) controller.dispose(); });
    };
  }, [runtime, controller]);
  useEffect(() => {
    if (isActive) void controller.start().catch(() => { /* Controller publishes the startup error. */ });
    // Hiding an already-active route does not interrupt generation or discard pending requests.
  }, [controller, isActive]);

  return { ...state, gateway, submit: controller.submit, stop: controller.stop, reconnect: controller.reconnect,
    setModel: controller.setModel, setReasoning: controller.setReasoning, respond: controller.respond, upload: controller.upload };
}
