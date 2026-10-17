import { z } from "zod";
export const OperatingMode = z.enum([
  "ASK_BEFORE_FIXING",
  "AUTO_FIX",
  "INDICATOR_ONLY",
]);
export type OperatingMode = z.infer<typeof OperatingMode>;
export const LifecycleState = z.enum([
  "DETECTED",
  "PRESENTED",
  "FLAGGED",
  "ACCEPTED_RISK",
  "AI_RECHECK_REQUESTED",
  "INVESTIGATING",
  "VERIFIED",
  "STILL_SUSPICIOUS",
  "REPAIR_FAILED",
]);
export type LifecycleState = z.infer<typeof LifecycleState>;
export const UserAction = z.enum(["fix", "evidence", "flag", "accept_risk"]);
export type UserAction = z.infer<typeof UserAction>;
export type InteractionAuthority =
  | "host-user-prompt"
  | "mcp-elicitation"
  | "auto-policy";
export interface FindingLifecycle {
  findingId: string;
  repositoryRoot: string;
  snapshot: string;
  state: LifecycleState;
  updatedAt: string;
  reason?: string;
  verificationFindingId?: string;
}
export interface RepairRecord {
  id: string;
  findingId: string;
  repositoryRoot: string;
  lineage: string;
  host: string;
  sessionId: string;
  attempt: number;
  state: "INVESTIGATING" | "COMPLETE" | "CANCELLED" | "ABANDONED";
  startedAt: string;
  expiresAt: string;
  outcome?: "VERIFIED" | "STILL_SUSPICIOUS" | "CONTRADICTED" | "REPAIR_FAILED";
  verificationFindingId?: string;
  agentSummary?: string;
}
export interface HostCapabilities {
  host: string;
  nativeNotifications: boolean;
  nativeInteractiveChoices: boolean;
  conversationVisibleWarnings: boolean;
  sameSessionRepairInstructions: boolean;
  commandsOrSkills: boolean;
  lifecycleHooks: boolean;
  mcpTools: boolean;
  canResumeIdleTurn: boolean;
}
export interface FindingView {
  findingId: string;
  statement: string;
  evidenceStatus: string;
  lifecycle: LifecycleState;
  confirmed: boolean;
  locations: { file: string; line?: number }[];
  model?: { provider: string; version: string; risk: number; impact: number };
  evidence: unknown[];
  nextStep: string;
  stale: boolean;
}
export interface HostInteractionAdapter {
  capabilities(): HostCapabilities;
  showFinding(view: FindingView, mode: OperatingMode): string;
  requestUserAction?(
    view: FindingView,
    actions: UserAction[],
  ): Promise<{ action: UserAction; reason?: string } | null>;
}
