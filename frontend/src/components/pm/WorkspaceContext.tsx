import { createContext, useContext } from "react";
import { DEFAULT_CONFIG, type WorkspaceConfig } from "@/api/pm-workspace";

export const WorkspaceContext = createContext<WorkspaceConfig>(DEFAULT_CONFIG);
export function useWorkspace() { return useContext(WorkspaceContext); }
