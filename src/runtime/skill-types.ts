export type SkillRunStatus = "pending" | "running" | "blocked" | "completed";
export type SkillWorkflowStage = "loaded" | "initialized" | "executing" | "artifact_written" | "verified" | "blocked" | "completed";

export interface SkillRunRecord {
  id: string;
  skillName: string;
  sourcePath: string;
  args: string;
  requestedBy: string;
  requiredArtifacts: string[];
  workflowStage: SkillWorkflowStage;
  workflowStages: SkillWorkflowStage[];
  status: SkillRunStatus;
  blocker: string | null;
  completionEvidence: string[];
  startedAt: string;
  updatedAt: string;
}
