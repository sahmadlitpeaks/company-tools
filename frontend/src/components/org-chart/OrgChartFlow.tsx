import { memo, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { OrgNode } from "@/api/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const NODE_WIDTH = 288;
const NODE_HEIGHT = 176;
const SIBLING_GAP = 40;
const ROOT_GAP = 80;
const LEVEL_GAP = 96;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.5;
const keepNodePointerEvents = () => undefined;

type OrgChartNodeData = {
  person: OrgNode;
  expanded: boolean;
  filtering: boolean;
  isRoot: boolean;
  onToggle: (id: string) => void;
};

type OrgChartFlowNode = Node<OrgChartNodeData, "orgPerson">;
type OrgChartFlowEdge = Edge<Record<string, unknown>, "smoothstep"> & {
  pathOptions?: { borderRadius?: number; offset?: number; stepPosition?: number };
};

function initials(name?: string | null): string {
  const source = (name || "?").trim().split(/\s+/);
  return (source.length > 1 ? source[0][0] + source[1][0] : source[0].slice(0, 2)).toUpperCase();
}

const OrgPersonNode = memo(function OrgPersonNode({ data }: NodeProps<OrgChartFlowNode>) {
  const { person, expanded, filtering, isRoot, onToggle } = data;
  const hasReports = person.reports.length > 0;
  const name = person.name ?? "Unnamed person";

  return (
    <div className="relative h-44 w-72 pb-8">
      {!isRoot ? (
        <Handle
          type="target"
          position={Position.Top}
          isConnectable={false}
          aria-hidden="true"
        />
      ) : null}

      <Card size="sm" className="h-36 w-72 bg-card text-left shadow-sm">
        <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <Avatar size="lg">
            {person.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
            <AvatarFallback className="bg-primary/15 text-foreground">{initials(person.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <CardTitle className="truncate">
              <Link to={`/people/${person.id}`} className="nodrag nopan hover:underline">
                {name}
              </Link>
            </CardTitle>
            <CardDescription className="truncate">{person.job_title || "No title"}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className="max-w-40 truncate">
            {person.department_name || "No department"}
          </Badge>
          <Badge variant="secondary">
            {person.report_count} direct {person.report_count === 1 ? "report" : "reports"}
          </Badge>
        </CardContent>
      </Card>

      {hasReports ? <Handle type="source" position={Position.Bottom} isConnectable={false} aria-hidden="true" /> : null}
      {hasReports && !filtering ? (
        <div className="nopan absolute inset-x-0 bottom-0 z-10 flex h-8 items-center justify-center">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="nodrag nopan bg-card shadow-sm"
            onClick={() => onToggle(person.id)}
            aria-label={`${expanded ? "Collapse" : "Expand"} reports for ${name}`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        </div>
      ) : null}
    </div>
  );
});

const nodeTypes = { orgPerson: OrgPersonNode } satisfies NodeTypes;

function layoutOrganization(
  roots: OrgNode[],
  expanded: Set<string>,
  visibleIds: Set<string> | null,
  onToggle: (id: string) => void,
): { nodes: OrgChartFlowNode[]; edges: OrgChartFlowEdge[] } {
  const nodes: OrgChartFlowNode[] = [];
  const edges: OrgChartFlowEdge[] = [];
  const filtering = visibleIds !== null;
  const widthById = new Map<string, number>();

  function visibleChildren(person: OrgNode): OrgNode[] {
    if (!visibleIds) return person.reports;
    return person.reports.filter((report) => visibleIds.has(report.id));
  }

  function isOpen(person: OrgNode): boolean {
    return filtering || expanded.has(person.id);
  }

  function subtreeWidth(person: OrgNode): number {
    const cachedWidth = widthById.get(person.id);
    if (cachedWidth !== undefined) return cachedWidth;
    const children = isOpen(person) ? visibleChildren(person) : [];
    if (children.length === 0) {
      widthById.set(person.id, NODE_WIDTH);
      return NODE_WIDTH;
    }
    const childrenWidth = children.reduce((total, child) => total + subtreeWidth(child), 0);
    const width = Math.max(NODE_WIDTH, childrenWidth + SIBLING_GAP * (children.length - 1));
    widthById.set(person.id, width);
    return width;
  }

  function place(
    person: OrgNode,
    depth: number,
    left: number,
    parentId: string | null,
    parentName: string | null,
    isRoot: boolean,
  ): number {
    const width = subtreeWidth(person);
    const children = isOpen(person) ? visibleChildren(person) : [];
    const name = person.name ?? "Unnamed person";

    nodes.push({
      id: person.id,
      type: "orgPerson",
      position: {
        x: left + (width - NODE_WIDTH) / 2,
        y: depth * (NODE_HEIGHT + LEVEL_GAP),
      },
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      data: {
        person,
        expanded: isOpen(person),
        filtering,
        isRoot,
        onToggle,
      },
      ariaLabel: `${name}, ${person.job_title || "no title"}, ${person.department_name || "no department"}, ${person.report_count} direct ${person.report_count === 1 ? "report" : "reports"}`,
      draggable: false,
      selectable: false,
      focusable: false,
    });

    if (parentId) {
      edges.push({
        id: `${parentId}-${person.id}`,
        source: parentId,
        target: person.id,
        type: "smoothstep",
        pathOptions: { borderRadius: 0, offset: 28 },
        ariaLabel: `${name} reports to ${parentName ?? "manager"}`,
        focusable: false,
      });
    }

    if (children.length > 0) {
      const childrenWidth = children.reduce((total, child) => total + subtreeWidth(child), 0)
        + SIBLING_GAP * (children.length - 1);
      let childLeft = left + (width - childrenWidth) / 2;
      for (const child of children) {
        childLeft += place(child, depth + 1, childLeft, person.id, name, false) + SIBLING_GAP;
      }
    }

    return width;
  }

  let rootLeft = 0;
  for (const root of roots) {
    if (visibleIds && !visibleIds.has(root.id)) continue;
    rootLeft += place(root, 0, rootLeft, null, null, true) + ROOT_GAP;
  }

  return { nodes, edges };
}

function OrgChartCanvas({
  roots,
  expanded,
  visibleIds,
  onToggle,
}: {
  roots: OrgNode[];
  expanded: Set<string>;
  visibleIds: Set<string> | null;
  onToggle: (id: string) => void;
}) {
  const { fitView } = useReactFlow<OrgChartFlowNode, OrgChartFlowEdge>();
  const nodesInitialized = useNodesInitialized();
  const { nodes, edges } = useMemo(
    () => layoutOrganization(roots, expanded, visibleIds, onToggle),
    [expanded, onToggle, roots, visibleIds],
  );

  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void fitView({ padding: 0.16, minZoom: MIN_ZOOM, maxZoom: 1, duration: 0 });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [edges, fitView, nodes, nodesInitialized]);

  return (
    <ReactFlow<OrgChartFlowNode, OrgChartFlowEdge>
      data-testid="org-chart-flow"
      className="org-chart-flow"
      aria-label="Organization tree canvas. Pan to explore and use the controls to zoom or fit the hierarchy."
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={keepNodePointerEvents}
      edgesFocusable={false}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      panOnScroll
      panOnDrag
      zoomOnPinch
      zoomOnScroll
      zoomOnDoubleClick={false}
      fitView
      fitViewOptions={{ padding: 0.16, minZoom: MIN_ZOOM, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      ariaLabelConfig={{
        "controls.ariaLabel": "Organization chart viewport controls",
        "controls.zoomIn.ariaLabel": "Zoom in",
        "controls.zoomOut.ariaLabel": "Zoom out",
        "controls.fitView.ariaLabel": "Fit organization to view",
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls
        aria-label="Organization chart viewport controls"
        showInteractive={false}
        fitViewOptions={{ padding: 0.16, minZoom: MIN_ZOOM, maxZoom: 1 }}
      />
    </ReactFlow>
  );
}

export function OrgChartFlow(props: {
  roots: OrgNode[];
  expanded: Set<string>;
  visibleIds: Set<string> | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="h-[min(42rem,70vh)] min-h-[34rem] bg-muted/20">
      <ReactFlowProvider>
        <OrgChartCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
