export {
  adaptHook,
  handleHook,
  hookFeedback,
} from "../../claude-code/src/index.js";
export const codexCapabilities = {
  events: [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
  ],
  preToolDeny: true,
  preToolAsk: false,
  postToolUndo: false,
  stopContinuation: true,
  asyncPostTool: true,
  requiresHookTrust: true,
  publicDirectoryHooks: false,
  implicitMcpInterception: false,
} as const;
