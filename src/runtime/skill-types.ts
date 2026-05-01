export type SkillRunStatus = "pending" | "running" | "blocked" | "completed";

export interface SkillRunRecord {
  id: string;
  skillName: string;
  sourcePath: string;
  args: string;
  requestedBy: string;
  requiredArtifacts: string[];
  status: SkillRunStatus;
  blocker: string | null;
  completionEvidence: string[];
  startedAt: string;
  updatedAt: string;
}
