/** Product roadmap (`/api/pm/roadmap`, BRD section 9A). */

export type RoadmapPriority = "high" | "medium" | "low";
export type RoadmapHorizon = "now" | "next" | "later" | "future";
export type RoadmapStatus = "proposed" | "approved" | "in_progress" | "done" | "parked";

export interface RoadmapModule {
  id: string;
  name: string;
  position: number;
  archived: boolean;
}

export interface RoadmapProject {
  id: string;
  key: string;
  name: string;
  can_edit: boolean;
  can_decide: boolean;
  modules: RoadmapModule[];
}

export interface RoadmapFeature {
  id: string;
  key: string;
  title: string;
  project_id: string;
  project_key: string;
  project_name: string;
  module_id: string | null;
  module_name: string | null;
  priority: RoadmapPriority | null;
  horizon: RoadmapHorizon | null;
  status: RoadmapStatus;
  target_quarter: string | null;
  owner_id: string | null;
  owner_name: string | null;
  epics: Array<{ id: string; key: string; status: string; project_key: string }>;
  progress: { done: number; total: number; percent: number };
  can_edit: boolean;
  can_decide: boolean;
}

export interface Roadmap {
  projects: RoadmapProject[];
  features: RoadmapFeature[];
}

export const HORIZONS: Array<{ value: RoadmapHorizon; label: string }> = [
  { value: "now", label: "Now" },
  { value: "next", label: "Next" },
  { value: "later", label: "Later" },
  { value: "future", label: "Future" },
];

export const PRIORITIES: Array<{ value: RoadmapPriority; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const ROADMAP_STATUSES: Array<{ value: RoadmapStatus; label: string }> = [
  { value: "proposed", label: "Proposed" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "parked", label: "Parked" },
];

export function roadmapStatusVariant(status: RoadmapStatus): "outline" | "info" | "warning" | "success" | "secondary" {
  return status === "done" ? "success" : status === "in_progress" ? "info" : status === "approved" ? "warning"
    : status === "parked" ? "secondary" : "outline";
}

export function priorityVariant(priority: RoadmapPriority | null): "destructive" | "warning" | "outline" {
  return priority === "high" ? "destructive" : priority === "medium" ? "warning" : "outline";
}
