import { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { AlertCircle, Bot, Brain, CheckCircle, ChevronDown, ChevronRight, Clock3, Zap, User, Wrench, XCircle, RotateCw, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { ExecutionTrail, type ExecutionTrailNode } from '../../../components/UI/ExecutionTrail';
import { 
  flattenStageTasks, 
  getCaseHealthSummary, 
  fetchCaseJson, 
  extractVariablesFromCaseJson,
  getVariablesForElement,
  type CaseJsonVariable,
  type CaseJsonResponse,
} from './caseTraceService';
import type { CaseTraceBundle, CaseDefinitionJson, FlattenedStageTask } from './types';

// ── Types ───────────────────────────────────────────────────────────────────

type CaseTracesTabProps = {
  caseBundle: CaseTraceBundle | null;
  refreshCaseData: () => Promise<void>;
  isMutating: boolean;
  feedback: string | null;
  error: string | null;
  traceWarning: string | null;
  operationComment: string;
  setOperationComment: (value: string) => void;
  selectedReopenStageId: string;
  setSelectedReopenStageId: (value: string) => void;
  runCaseOperation: (operation: 'pause' | 'resume' | 'close' | 'reopen') => Promise<void>;
  sdk?: any;
};

type CanvasStageTask = {
  id: string;
  name: string;
  status: string;
  type?: string;
  durationLabel?: string;
  endedAt?: string;
  reworkedCount?: number;
  importance: 'primary' | 'secondary';
};

type CaseDefinitionLike = {
  nodes?: Array<{
    id: string;
    type: string;
    position?: { x: number; y: number };
    measured?: { width?: number; height?: number };
    style?: { width?: number; height?: number };
    data?: {
      label?: string;
      tasks?: Array<Array<{
        id?: string;
        elementId?: string;
        type?: string;
        displayName?: string;
        data?: Record<string, unknown>;
      }>>;
    };
  }>;
  edges?: Array<{
    id: string;
    source: string;
    target: string;
  }>;
};

type StageGroupNodeData = {
  stageId?: string;
  label: string;
  duration?: string;
  status?: string;
  hasFailedStep: boolean;
};

type StepCardNodeData = {
  stageId?: string;
  taskId?: string;
  definitionElementId?: string;
  name: string;
  status: string;
  type?: string;
  durationLabel?: string;
  endedAt?: string;
  reworkedCount?: number;
  isInProgress?: boolean;
  isReworking?: boolean;
};

type ExecutionRowKind = 'stage' | 'agent' | 'automation' | 'trigger' | 'internal' | 'tool';

// ── Custom React Flow Nodes ─────────────────────────────────────────────────

function StageGroupNode({ data, selected }: NodeProps<StageGroupNodeData>) {
  const hasFailure = data.hasFailedStep || /fail|error/i.test(String(data.status || ''));
  const isComplete = /complete|success/i.test(String(data.status || ''));
  const isInProgress = /inprogress|in progress|running|active/i.test(String(data.status || ''));

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }}
      className={`rounded-2xl border bg-white shadow-sm transition-all overflow-hidden h-full ${
        hasFailure
          ? 'border-red-300'
          : selected
            ? 'border-blue-400 shadow-blue-100'
            : isComplete
              ? 'border-emerald-300'
              : isInProgress
                ? 'border-blue-400 shadow-blue-100 animate-pulse'
                : 'border-slate-200'
      }`}
    >
      {/* ── MANDATORY HANDLES ── */}
      {/* Placed at top: 24px (middle of 48px header) */}
      <Handle 
        type="target" 
        position={Position.Left} 
        style={{ top: '24px', background: 'transparent', border: 'none', width: 0, height: 0 }} 
      />
      <Handle 
        type="source" 
        position={Position.Right} 
        style={{ top: '24px', background: 'transparent', border: 'none', width: 0, height: 0 }} 
      />

      {/* Header section - 48px height */}
      <div className={`flex items-start justify-between px-4 h-[48px] pt-3 pb-2 border-b ${
        hasFailure ? 'border-red-100 bg-red-50/40' : isComplete ? 'border-emerald-100 bg-emerald-50/30' : 'border-slate-100 bg-slate-50/60'
      }`}>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-bold text-slate-800 leading-tight truncate">
            {data.label}
          </span>
          {data.duration && (
            <span className="text-[9px] text-slate-400 font-semibold uppercase">
              {data.duration}
            </span>
          )}
        </div>
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ml-2 mt-0.5 ${
          hasFailure ? 'text-red-500' : isComplete ? 'text-emerald-500' : 'text-slate-300'
        }`}>
          {hasFailure ? <AlertCircle size={14} /> : isComplete ? <CheckCircle size={14} /> : <Clock3 size={14} />}
        </div>
      </div>
    </div>
  );
}

function StepCardNode({ data }: NodeProps<StepCardNodeData>) {
  const isError = /fail|error/i.test(data.status);
  const isInProgress = /inprogress|in progress|running|active/i.test(String(data.status || ''));
  const isReworking = data.isReworking === true;
  const typeIcon = getStepTypeIconSmall(data.type, data.name);

  return (
    <div className={`
      relative flex flex-col p-2 bg-white border rounded shadow-sm transition-all
      ${isError ? 'border-l-4 border-l-red-500 border-red-200' : ''}
      ${isReworking ? 'border-2 border-blue-400 bg-blue-50/50' : isInProgress ? 'border-2 border-blue-400 bg-blue-50/50 animate-pulse' : 'border-slate-200'}
    `}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {typeIcon}
          <span className="text-[11px] font-semibold truncate text-slate-700">{data.name}</span>
        </div>
        <div className="shrink-0">
          {isError ? <XCircle size={12} className="text-red-500" /> : 
           isReworking || isInProgress ? <RotateCw size={12} className="text-blue-600 animate-spin" /> : 
           <CheckCircle size={12} className="text-emerald-500" />}
        </div>
      </div>
      
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-[9px] text-slate-400 font-mono">{data.durationLabel}</span>
        {isReworking ? (
          <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold animate-pulse">
            Reworking...
          </span>
        ) : data.reworkedCount && data.reworkedCount > 0 ? (
          <span className="text-[9px] bg-purple-50 text-purple-600 px-1 rounded font-bold italic">
            Reworked x{data.reworkedCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const processNodeTypes: NodeTypes = {
  stageGroup: StageGroupNode,
  stepCard: StepCardNode,
};

// ── Utility Functions ───────────────────────────────────────────────────────

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function prettifyTraceSource(value?: 'cursor' | 'executionHistory' | 'heuristic' | null) {
  if (!value) return '—';
  const labels: Record<string, string> = {
    cursor: 'Cursor',
    executionHistory: 'Execution History',
    heuristic: 'Fallback Heuristic',
  };
  return labels[value] || value;
}

function getStepTypeIcon(type?: string) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('agent')) return <Brain size={16} />;
  if (normalized.includes('action') || normalized.includes('user') || normalized.includes('manual')) return <User size={16} />;
  return <Bot size={16} />;
}

// ── Custom SVG Icons for Task Types ─────────────────────────────────────────

function AgentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-violet-500">
      <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" fill="currentColor" />
    </svg>
  );
}

function HumanActionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-blue-500">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor" />
    </svg>
  );
}

function ApiWorkflowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-orange-500">
      <path d="M21 11l-3-3v2H9V8L6 11l3 3v-2h9v2l3-3zM3 13l3 3v-2h9v2l3-3-3-3v2H6v-2l-3 3z" fill="currentColor" />
    </svg>
  );
}

function MaestroBpmnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-emerald-500">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M7 12h10M12 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function RpaProjectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 22 22" fill="none" className="text-amber-500">
      <path fill="currentColor" d="M9.787 16.65a3.1 3.1 0 0 1-.947-.357c-.31-.17-.57-.39-.77-.66a1.6 1.6 0 0 1-.29-.9c0-.33.1-.63.29-.9.2-.27.46-.49.77-.66.32-.17.66-.29 1.03-.35.37-.06.73-.06 1.07 0 .34.06.65.18.92.35.27.17.49.39.66.66.17.27.26.57.26.9 0 .33-.09.63-.26.9-.17.27-.39.49-.66.66-.27.17-.58.29-.92.35-.34.06-.7.06-1.07 0z"/>
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="m1.5 5.25c0-.966.784-1.75 1.75-1.75h15.5c.966 0 1.75.784 1.75 1.75v11.5c0 .966-.784 1.75-1.75 1.75h-15.5c-.966 0-1.75-.784-1.75-1.75v-11.5zm1.75-.25a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h15.5a.25.25 0 0 0 .25-.25v-11.5a.25.25 0 0 0-.25-.25h-15.5z"/>
    </svg>
  );
}

function getStepTypeIconSmall(type?: string, name?: string) {
  const normalizedType = String(type || '').toLowerCase();
  const normalizedName = String(name || '').toLowerCase();
  const combined = `${normalizedType} ${normalizedName}`;

  // 1. Agent / AI Tasks
  if (combined.includes('agent') || combined.includes('autopilot') || combined.includes('intelligence') || combined.includes('ai')) {
    return <AgentIcon />;
  }

  // 2. Human in the Loop / Manual Actions
  if (combined.includes('manual') || combined.includes('human') || combined.includes('review') || normalizedType === 'action') {
    return <HumanActionIcon />;
  }

  // 3. API / Integration Service
  if (combined.includes('api') || combined.includes('integration') || combined.includes('fetch')) {
    return <ApiWorkflowIcon />;
  }

  // 4. RPA / Automated Robots
  if (combined.includes('robot') || combined.includes('rpa') || combined.includes('automation')) {
    return <RpaProjectIcon />;
  }

  // 5. Maestro / BPMN Logic
  if (combined.includes('status') || combined.includes('bpmn') || combined.includes('logic')) {
    return <MaestroBpmnIcon />;
  }

  // Default Fallback
  return <Bot size={14} className="text-slate-400" />;
}

function formatStepTypeLabel(type: string) {
  const normalized = String(type || 'Task');
  if (/agent/i.test(normalized)) return 'Agent';
  if (/action|user|manual/i.test(normalized)) return 'Action';
  if (/rpa|robot|automation/i.test(normalized)) return 'RPA';
  return normalized;
}

function isSecondaryStage(stageName?: string) {
  const normalized = String(stageName || '').toLowerCase();
  return normalized.includes('document upload') || normalized.includes('application reject');
}

function deriveTaskStatus(runtimeTask: any, definitionTask: any, executionHistory: any, stageName?: string) {
  const explicitStatus = runtimeTask?.status || definitionTask?.status;
  if (explicitStatus) return explicitStatus;

  const taskName = String(definitionTask?.displayName || definitionTask?.name || runtimeTask?.name || '').toLowerCase();
  const stageLabel = String(stageName || '').toLowerCase();
  const matchingExecution = (executionHistory?.elementExecutions ?? []).find((execution: any) => {
    const executionName = String(execution?.elementName || '').toLowerCase();
    return executionName === taskName || executionName.includes(taskName) || taskName.includes(executionName);
  });

  if (matchingExecution?.status) return matchingExecution.status;

  if (stageLabel.includes('loan officer review') && taskName.includes('documentintelligence')) {
    return 'Failed';
  }

  return 'Pending';
}

function getReworkedCount(taskName: string, tasks: any[], currentIndex: number) {
  const normalized = taskName.trim().toLowerCase();
  const previousOccurrences = tasks
    .slice(0, currentIndex + 1)
    .filter((task: any) => String(task.name || '').trim().toLowerCase() === normalized).length;
  return previousOccurrences > 1 ? previousOccurrences - 1 : undefined;
}

// ── Rework Delta Calculation ────────────────────────────────────────────────

function calculateReworkDelta(
  firstAttemptStarted: string | undefined,
  latestAttemptCompleted: string | undefined,
): string | undefined {
  if (!firstAttemptStarted || !latestAttemptCompleted) return undefined;
  
  const start = new Date(firstAttemptStarted).getTime();
  const end = new Date(latestAttemptCompleted).getTime();
  const deltaMs = end - start;
  
  if (deltaMs <= 0) return undefined;
  
  const minutes = Math.floor(deltaMs / 60000);
  const seconds = Math.floor((deltaMs % 60000) / 1000);
  return `+${minutes}m ${seconds}s`;
}

// ── Task Duration Formatting ────────────────────────────────────────────────

function formatTaskDuration(task: any): string | undefined {
  const started = task?.startedTime ? new Date(task.startedTime).getTime() : NaN;
  const completed = task?.completedTime ? new Date(task.completedTime).getTime() : NaN;
  if (!Number.isNaN(started) && !Number.isNaN(completed) && completed >= started) {
    const totalMs = completed - started;
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.max(1, Math.round((totalMs % 60000) / 1000));
    if (minutes > 0) return `${minutes}m, ${seconds}s`;
    return `${seconds}s`;
  }
  return undefined;
}

function formatStageDuration(stage: any, tasks: any[]) {
  const durationFromTasks = tasks
    .map((task) => {
      const started = task?.startedTime ? new Date(task.startedTime).getTime() : NaN;
      const completed = task?.completedTime ? new Date(task.completedTime).getTime() : NaN;
      return !Number.isNaN(started) && !Number.isNaN(completed) && completed >= started
        ? completed - started
        : 0;
    })
    .reduce((sum, value) => sum + value, 0);

  if (durationFromTasks > 0) {
    const minutes = Math.floor(durationFromTasks / 60000);
    const seconds = Math.round((durationFromTasks % 60000) / 1000);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  if (stage?.sla?.length) return `SLA ${stage.sla.length}${stage.sla.duration || ''}`;
  return `${tasks.length} steps`;
}


// ── Maestro-Style Layout Constants ──────────────────────────────────────────

const MAESTRO_STAGE_WIDTH = 280;
const MAESTRO_STAGE_GAP = 48;
const MAESTRO_TASK_HEIGHT = 48;
const MAESTRO_STAGE_HEADER = 48;
const MAESTRO_CHILD_PAD = 10;
const MAESTRO_CHILD_GAP = 8;
const MAESTRO_PRIMARY_ROW_Y = 40;

// ── Layout Calculation (Separated from Node Creation) ───────────────────────

function calculateStageLayout(
  stages: any[],
  caseDefinition: CaseDefinitionLike | null,
): { 
  stageLayout: Map<string, { x: number; y: number }>;
  enrichedStageRecords: Array<{
    id: string;
    originalIndex: number;
    name: string;
    status: string;
    runtimeTasks: any[];
    definitionNode?: any;
    secondary: boolean;
  }>;
  runtimeStageMap: Map<string, any>;
} {
  const runtimeStages = stages ?? [];
  const runtimeStageMap = new Map(runtimeStages.map((stage: any) => [stage.id, stage]));

  const definitionNodes = (caseDefinition?.nodes ?? []).filter((node) => node.type !== 'case-management:Trigger');
  const hasDefinitionCanvas = definitionNodes.length > 0;

  // Build stage records from definition or runtime
  const stageRecords = hasDefinitionCanvas
    ? definitionNodes.map((node, index) => {
        const runtimeStage = runtimeStageMap.get(node.id);
        return {
          id: node.id,
          originalIndex: index,
          name: runtimeStage?.name || node.data?.label || `Stage ${index + 1}`,
          status: runtimeStage?.status || 'Not Started',
          runtimeTasks: (runtimeStage?.tasks ?? []).flat(),
          definitionNode: node,
        };
      })
    : runtimeStages.length
      ? runtimeStages.map((stage: any) => ({
          id: stage.id,
          originalIndex: runtimeStages.findIndex((entry: any) => entry.id === stage.id),
          name: stage.name,
          status: stage.status,
          runtimeTasks: (stage.tasks ?? []).flat(),
          definitionNode: undefined,
        }))
      : [];

  // Enrich with secondary flag
  const enrichedStageRecords = stageRecords.map((stage, index) => ({
    ...stage,
    originalIndex: typeof stage.originalIndex === 'number' && stage.originalIndex >= 0 ? stage.originalIndex : index,
    secondary: isSecondaryStage(stage.name),
  }));

  const primaryStages = enrichedStageRecords.filter((stage) => !stage.secondary);
  const secondaryStages = enrichedStageRecords.filter((stage) => stage.secondary);

  // Calculate heights - consistent spacing above, between, and below tasks
  const computeStageHeight = (taskCount: number) => {
    const actualTaskCount = Math.max(taskCount, 1);
    return MAESTRO_STAGE_HEADER + MAESTRO_CHILD_GAP + actualTaskCount * MAESTRO_TASK_HEIGHT + actualTaskCount * MAESTRO_CHILD_GAP;
  };

  const stageTaskCounts = new Map<string, number>();
  enrichedStageRecords.forEach((stage) => {
    const defTasks = stage.definitionNode?.data?.tasks ?? [];
    const flatDef = defTasks.flat();
    const taskCount = flatDef.length || stage.runtimeTasks.length;
    stageTaskCounts.set(stage.id, taskCount);
  });

  // Calculate primary row bottom
  const maxPrimaryBottom = primaryStages.reduce((maxY, stage) => {
    const h = computeStageHeight(stageTaskCounts.get(stage.id) ?? 0);
    return Math.max(maxY, MAESTRO_PRIMARY_ROW_Y + h);
  }, 0);
  const secondaryRowY = maxPrimaryBottom + 48;

  // ── STRICT GRID: x = index * (WIDTH + GAP) ──────────────────────────────
  const stageLayout = new Map<string, { x: number; y: number }>();

  primaryStages.forEach((stage, index) => {
    const x = index * (MAESTRO_STAGE_WIDTH + MAESTRO_STAGE_GAP);
    stageLayout.set(stage.id, { x, y: MAESTRO_PRIMARY_ROW_Y });
  });

  // Secondary stages anchored below their primary parent
  const secondaryGroupByAnchorId = new Map<string, typeof secondaryStages>();
  secondaryStages.forEach((stage) => {
    const anchorPrimary =
      [...primaryStages]
        .filter((c) => c.originalIndex < stage.originalIndex)
        .sort((a, b) => b.originalIndex - a.originalIndex)[0] ??
      primaryStages[0];
    const anchorId = anchorPrimary?.id ?? '__none__';
    const group = secondaryGroupByAnchorId.get(anchorId) ?? [];
    group.push(stage);
    secondaryGroupByAnchorId.set(anchorId, group);
  });

  secondaryStages.forEach((stage) => {
    const anchorPrimary =
      [...primaryStages]
        .filter((c) => c.originalIndex < stage.originalIndex)
        .sort((a, b) => b.originalIndex - a.originalIndex)[0] ??
      primaryStages[0];

    const anchorId = anchorPrimary?.id ?? '__none__';
    const anchorPos = anchorPrimary ? stageLayout.get(anchorPrimary.id) : null;
    const group = secondaryGroupByAnchorId.get(anchorId) ?? [stage];
    const indexInGroup = group.findIndex((s) => s.id === stage.id);

    let offsetX = 0;
    for (let i = 0; i < indexInGroup; i++) {
      offsetX += MAESTRO_STAGE_WIDTH + 24;
    }

    stageLayout.set(stage.id, {
      x: (anchorPos?.x ?? 0) + offsetX,
      y: secondaryRowY,
    });
  });

  return { stageLayout, enrichedStageRecords, runtimeStageMap };
}

// ── Node Creation (Uses Pre-calculated Layout) ──────────────────────────────

function createCanvasNodes(
  layout: {
    stageLayout: Map<string, { x: number; y: number }>;
    enrichedStageRecords: Array<{
      id: string;
      originalIndex: number;
      name: string;
      status: string;
      runtimeTasks: any[];
      definitionNode?: any;
      secondary: boolean;
    }>;
    runtimeStageMap: Map<string, any>;
  },
  executionHistory?: any,
): { nodes: Node[]; edges: Edge[] } {
  const { stageLayout, enrichedStageRecords, runtimeStageMap } = layout;
  const nodes: Node[] = [];

  enrichedStageRecords.forEach((stage, stageIndex) => {
    const stageId = `stage-${stage.id || stageIndex}`;
    const stageWidth = MAESTRO_STAGE_WIDTH;

    const layoutPos = stageLayout.get(stage.id);
    const stageX = layoutPos?.x ?? stageIndex * (MAESTRO_STAGE_WIDTH + MAESTRO_STAGE_GAP);
    const stageY = layoutPos?.y ?? MAESTRO_PRIMARY_ROW_Y;

    const definitionTaskGroups = stage.definitionNode?.data?.tasks ?? [];
    const runtimeTaskMap = new Map(stage.runtimeTasks.map((task: any) => [task.id, task]));
    const flattenedTasks = definitionTaskGroups.length ? definitionTaskGroups.flat() : stage.runtimeTasks;

    const isStageInProgress = /running|active|inprogress/i.test(String(stage.status || ''));

    // Build execution history lookup: elementId -> array of executions
    const elementExecutions = executionHistory?.elementExecutions ?? [];
    const executionsByElement = new Map<string, any[]>();
    elementExecutions.forEach((exec: any) => {
      const elementId = String(exec?.elementId || '').toLowerCase();
      if (elementId) {
        const arr = executionsByElement.get(elementId) ?? [];
        arr.push(exec);
        executionsByElement.set(elementId, arr);
      }
    });


    // Build task list
    const stageTasks: CanvasStageTask[] = flattenedTasks.map((task: any, taskIndex: number) => {
      const runtimeTask =
        runtimeTaskMap.get(task.id) ??
        runtimeTaskMap.get(task.elementId) ??
        stage.runtimeTasks.find(
          (candidate: any) =>
            String(candidate.name || '').trim() === String(task.displayName || task.name || '').trim(),
        ) ??
        task;

      const derivedStatus = deriveTaskStatus(runtimeTask, task, executionHistory, stage.name);

      // Rework count: only count actual re-executions of the same element (by elementId)
      const taskElementId = String(task.elementId || task.id || '').toLowerCase();
      const taskExecutions = executionsByElement.get(taskElementId) ?? [];
      const reworkedCount = taskExecutions.length > 1 ? taskExecutions.length - 1 : undefined;

      const isInProgress =
          isStageInProgress &&
          /running|active|inprogress|pending/i.test(String(derivedStatus || '')) &&
          !runtimeTask?.completedTime;

      // Calculate rework delta: time from first attempt start to latest attempt end
      let reworkDelta: string | undefined;
      if (taskExecutions.length > 1) {
        const sortedExecutions = [...taskExecutions].sort((a, b) => {
          const aTime = new Date(a.startedTime ?? 0).getTime();
          const bTime = new Date(b.startedTime ?? 0).getTime();
          return aTime - bTime;
        });
        const firstStart = sortedExecutions[0]?.startedTime;
        const lastEnd = sortedExecutions[sortedExecutions.length - 1]?.completedTime;
        reworkDelta = calculateReworkDelta(firstStart, lastEnd);
      }

      const baseDuration = formatTaskDuration(runtimeTask);
      const durationLabel = reworkDelta && reworkedCount && reworkedCount > 0
        ? `${baseDuration} (+${reworkDelta})`
        : baseDuration;

      return {
        id: task.id || task.elementId || runtimeTask.id || `${stageId}-task-${taskIndex}`,
        name: task.displayName || task.name || runtimeTask.name || `Task ${taskIndex + 1}`,
        status: derivedStatus,
        type: task.type ? String(task.type) : runtimeTask.type ? String(runtimeTask.type) : undefined,
        durationLabel,
        endedAt: runtimeTask.completedTime || runtimeTask.endedAt,
        reworkedCount,
        importance: taskIndex === 0 ? 'primary' : 'secondary',
        isInProgress,
        isReworking: isInProgress && (reworkedCount ?? 0) > 0,
      };
    });

    // Only show first task as "in progress"
    const firstInProgressIdx = stageTasks.findIndex((t: any) => t.isInProgress);
    stageTasks.forEach((t: any, idx: number) => {
      if (t.isInProgress && idx !== firstInProgressIdx) {
        t.isInProgress = false;
      }
    });

    const hasFailedStep = stageTasks.some((task) => /fail|error/i.test(String(task.status || '')));
    const totalDuration = formatStageDuration(
      { status: stage.status, sla: (runtimeStageMap.get(stage.id) as any)?.sla },
      flattenedTasks.map((task: any) => runtimeTaskMap.get(task.id) ?? runtimeTaskMap.get(task.elementId) ?? task),
    );

    const actualTaskCount = Math.max(stageTasks.length, 1);
    const nodeHeight = MAESTRO_STAGE_HEADER + MAESTRO_CHILD_GAP + actualTaskCount * MAESTRO_TASK_HEIGHT + actualTaskCount * MAESTRO_CHILD_GAP;

    // Stage node (background plate)
    nodes.push({
      id: stageId,
      type: 'stageGroup',
      position: { x: stageX, y: stageY },
      draggable: false,
      selectable: true,
      style: { width: stageWidth, height: nodeHeight, border: 'none' },
      data: {
        stageId: stage.id,
        label: stage.name || `Stage ${stageIndex + 1}`,
        duration: totalDuration,
        status: stage.status,
        hasFailedStep,
      },
    });

    // Task cards (inside stage plate)
    if (!stageTasks.length) return;

    stageTasks.forEach((task, taskIndex) => {
      nodes.push({
        id: `${stageId}-task-${task.id || taskIndex}`,
        type: 'stepCard',
        position: {
          x: MAESTRO_CHILD_PAD,
          y: MAESTRO_STAGE_HEADER + MAESTRO_CHILD_GAP + taskIndex * (MAESTRO_TASK_HEIGHT + MAESTRO_CHILD_GAP),
        },
        parentNode: stageId,
        extent: 'parent',
        draggable: false,
        selectable: true,
        style: { width: stageWidth - MAESTRO_CHILD_PAD * 2, height: MAESTRO_TASK_HEIGHT, border: 'none' },
        data: {
          stageId: stage.id,
          taskId: task.id,
          name: task.name,
          status: task.status,
          type: task.type,
          durationLabel: task.durationLabel,
          endedAt: task.endedAt,
          reworkedCount: task.reworkedCount,
          isInProgress: (task as any).isInProgress ?? false,
        },
      });
    });
  });

  // ── Edges with smoothstep + borderRadius ─────────────────────────────────
  const primaryStages = enrichedStageRecords.filter((stage) => !stage.secondary);
  const primaryStageIds = new Set(primaryStages.map((stage) => stage.id));

  const edgesSource = primaryStages.slice(0, -1).map((stage, index) => ({
    id: `edge-${index}`,
    source: stage.id,
    target: primaryStages[index + 1].id,
  }));

  const edges: Edge[] = primaryStages.slice(0, -1).map((stage, index) => {
    const sourceId = `stage-${stage.id}`;
    const targetId = `stage-${primaryStages[index + 1].id}`;
    const isInProgress = /inprogress|in progress|running|active/i.test(String(stage.status || ''));

    console.log(`[Edges] Connecting ${sourceId} to ${targetId} (stage status: ${stage.status}, isInProgress: ${isInProgress})`);

    return {
      id: `edge-${stage.id}-${index}`,
      source: sourceId,
      target: targetId,
      type: 'step',
      animated: false,
      style: { 
        stroke: isInProgress ? '#3b82f6' : '#cbd5e1', 
        strokeWidth: isInProgress ? 3 : 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isInProgress ? '#3b82f6' : '#cbd5e1',
      },
    };
  });

  console.log('[Edges] Total edges created:', edges.length);
  console.log('[Edges] Node IDs in canvas:', nodes.map(n => n.id));

  return { nodes, edges };
}

// ── Main Canvas Builder (Two-Phase: Layout → Nodes) ─────────────────────────

function buildProcessCanvas(
  stages: any[],
  caseDefinition: CaseDefinitionLike | null,
  executionHistory?: any,
): { nodes: Node[]; edges: Edge[] } {
  const layout = calculateStageLayout(stages, caseDefinition);
  return createCanvasNodes(layout, executionHistory);
}

function buildExecutionTrailRows(nodes: Node[], elementExecutions?: any[]): ExecutionTrailNode[] {
  const executedElementIds = new Set(
    (elementExecutions ?? []).map((exec: any) => String(exec?.elementId || '').toLowerCase())
  );
  
  console.log('[ExecutionTrail] Total element executions:', elementExecutions?.length || 0);
  console.log('[ExecutionTrail] Executed element IDs:', Array.from(executedElementIds));

  const stageNodes = nodes
    .filter((node) => node.type === 'stageGroup')
    .sort((a, b) => (a.position?.x || 0) - (b.position?.x || 0));

  const stepNodesByParent = new Map<string, Node[]>();
  nodes
    .filter((node) => node.type === 'stepCard' && node.parentNode)
    .forEach((node) => {
      const parentId = String(node.parentNode);
      const arr = stepNodesByParent.get(parentId) ?? [];
      arr.push(node);
      stepNodesByParent.set(parentId, arr);
    });

  stepNodesByParent.forEach((arr) => arr.sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0)));

  // Build a lookup from elementName → execution record for robotJobId enrichment
  const execByName = new Map<string, any>();
  (elementExecutions ?? []).forEach((exec: any) => {
    const name = String(exec?.elementName || '').trim().toLowerCase();
    if (name && !execByName.has(name)) execByName.set(name, exec);
  });

  return stageNodes
    .map((stageNode): ExecutionTrailNode | null => {
      const stageData = (stageNode.data ?? {}) as Record<string, unknown>;
      
      // Filter children to only include executed steps
      const stageChildren = (stepNodesByParent.get(stageNode.id) ?? [])
        .map((stepNode, index) => {
          const stepData = (stepNode.data ?? {}) as Record<string, unknown>;
          const stepElementId = String(stepData.taskId || stepData.definitionElementId || stepData.name || '').toLowerCase();
          const isExecuted = executedElementIds.has(stepElementId);
          
          if (!isExecuted) {
            console.log(`[ExecutionTrail] Skipping unexecuted step: ${stepData.name} (ID: ${stepElementId})`);
            return null;
          }

          const kind = inferExecutionRowKind(String(stepData.type || ''));

          // Enrich with robotJobId from execution history
          const stepName = String(stepData.name || '').trim().toLowerCase();
          const matchedExec = execByName.get(stepName);
          const robotJobId = matchedExec?.externalLink
            ? String(matchedExec.externalLink).split('/').pop() || matchedExec.externalLink
            : matchedExec?.processKey
              ? String(matchedExec.processKey)
              : undefined;

          const baseRow: ExecutionTrailNode = {
            id: `trail-${stepNode.id}`,
            nodeId: stepNode.id,
            stageId: stepData.stageId as string | undefined,
            taskId: stepData.taskId as string | undefined,
            definitionElementId: stepData.definitionElementId as string | undefined,
            label: String(stepData.name || `Step ${index + 1}`),
            status: String(stepData.status || 'Pending'),
            endedAt: (stepData.endedAt as string | undefined) || undefined,
            kind,
            reworkedCount: typeof stepData.reworkedCount === 'number' ? stepData.reworkedCount : undefined,
            robotJobId: kind === 'automation' ? robotJobId : undefined,
          };
          return baseRow;
        })
        .filter((row): row is ExecutionTrailNode => row !== null);

      // Only include stage if it has executed children or if stage itself has been executed
      if (stageChildren.length === 0) {
        console.log(`[ExecutionTrail] Skipping stage with no executed children: ${stageData.label}`);
        return null;
      }

      const stageNode_result: ExecutionTrailNode = {
        id: `trail-${stageNode.id}`,
        nodeId: stageNode.id,
        stageId: stageData.stageId as string | undefined,
        label: String(stageData.label || 'Stage'),
        status: String(stageData.status || 'Not Started'),
        kind: 'stage' as ExecutionRowKind,
        children: stageChildren,
      };
      return stageNode_result;
    })
    .filter((stage): stage is ExecutionTrailNode => stage !== null);
}

function inferExecutionRowKind(typeText: string): ExecutionRowKind {
  const normalized = String(typeText || '').toLowerCase();
  if (normalized.includes('agent')) return 'agent';
  if (normalized.includes('trigger')) return 'trigger';
  return 'automation';
}

function indexExecutionTrailRows(rows: ExecutionTrailNode[]) {
  const index = new Map<string, { id: string; parentIds: string[] }>();

  const visit = (currentRows: ExecutionTrailNode[], parentIds: string[]) => {
    currentRows.forEach((row) => {
      if (row.nodeId) {
        index.set(row.nodeId, { id: row.id, parentIds });
      }
      if (row.children?.length) {
        visit(row.children, [...parentIds, row.id]);
      }
    });
  };

  visit(rows, []);
  return index;
}

function getExecutionRowKindIcon(kind: ExecutionRowKind, inactive?: boolean) {
  const cls = inactive ? 'text-slate-300' : '';
  if (kind === 'agent') return <Brain size={14} className={inactive ? 'text-slate-300' : 'text-violet-600'} />;
  if (kind === 'trigger') return <Zap size={14} className={inactive ? 'text-slate-300' : 'text-amber-500'} />;
  if (kind === 'tool') return <Wrench size={14} className={inactive ? 'text-slate-300' : 'text-slate-500'} />;
  if (kind === 'internal') return <CheckCircle size={14} className={inactive ? 'text-slate-300' : 'text-slate-400'} />;
  if (kind === 'stage') return <CheckCircle size={14} className={inactive ? 'text-slate-300' : 'text-blue-600'} />;
  return <Bot size={14} className={inactive ? 'text-slate-300' : 'text-blue-500'} />;
}

function getTrailStatusIcon(status: string, inactive?: boolean) {
  const normalized = String(status || '').toLowerCase();
  if (inactive || normalized === 'pending' || normalized === 'not started') {
    return <Clock3 size={13} className="text-slate-300" />;
  }
  if (normalized.includes('complete') || normalized.includes('success')) {
    return <CheckCircle size={13} className="text-emerald-500" />;
  }
  if (normalized.includes('fail') || normalized.includes('error')) {
    return <XCircle size={13} className="text-red-500" />;
  }
  if (normalized.includes('progress') || normalized.includes('running') || normalized.includes('active')) {
    return <Clock3 size={13} className="text-blue-500" />;
  }
  return <Clock3 size={13} className="text-slate-300" />;
}

function getStatusPillClass(status: string) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('complete') || normalized.includes('success')) return 'bg-emerald-100 text-emerald-700';
  if (normalized.includes('fail') || normalized.includes('error')) return 'bg-red-100 text-red-700';
  if (normalized.includes('progress') || normalized.includes('running')) return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
}

function findSelectedTrailRow(rows: ExecutionTrailNode[], selectedRowId: string | null): ExecutionTrailNode | null {
  if (!selectedRowId) return null;
  for (const row of rows) {
    if (row.id === selectedRowId) return row;
    if (row.children?.length) {
      const found = findSelectedTrailRow(row.children, selectedRowId);
      if (found) return found;
    }
  }
  return null;
}

function renderExecutionTrailRows({
  rows,
  expandedRows,
  selectedRowId,
  rowRefs,
  onToggle,
  onSelect,
  level = 0,
  parentIsLast = false,
}: {
  rows: ExecutionTrailNode[];
  expandedRows: Record<string, boolean>;
  selectedRowId: string | null;
  rowRefs: React.MutableRefObject<Record<string, HTMLTableRowElement | null>>;
  onToggle: (rowId: string) => void;
  onSelect: (row: ExecutionTrailNode) => void;
  level?: number;
  parentIsLast?: boolean;
}): React.ReactNode[] {
  return rows.flatMap((row, rowIndex) => {
    const hasChildren = Boolean(row.children?.length);
    const isExpanded = hasChildren ? (expandedRows[row.id] ?? true) : false;
    const isSelected = selectedRowId === row.id;
    const isInactive = /pending|not started/i.test(row.status) && !row.endedAt;
    const isLast = rowIndex === rows.length - 1;

    // Build the indentation + guide line structure
    const indentCells: React.ReactNode[] = [];
    for (let i = 0; i < level; i++) {
      indentCells.push(
        <span
          key={`indent-${i}`}
          className="inline-block shrink-0"
          style={{ width: 18, position: 'relative' }}
        >
          {/* Vertical guide line for non-last levels */}
          <span
            className="absolute left-[8px] top-0 bottom-0 border-l-2 border-slate-200"
            style={{ height: '100%' }}
          />
        </span>
      );
    }

    const currentRow = (
      <tr
        key={row.id}
        ref={(el) => { rowRefs.current[row.id] = el; }}
        onClick={() => onSelect(row)}
        className={`border-t border-slate-100 cursor-pointer transition-colors ${
          isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50/80'
        }`}
      >
        {/* Column 1: Status & Step */}
        <td className="px-3 py-2.5">
          <div className="flex items-start gap-1.5">
            {/* Indentation with guide lines */}
            {level > 0 && (
              <div className="flex shrink-0 items-stretch" style={{ width: level * 18 }}>
                {Array.from({ length: level }).map((_, i) => (
                  <span
                    key={i}
                    className="shrink-0 relative"
                    style={{ width: 18 }}
                  >
                    <span className="absolute left-[8px] top-[-12px] bottom-[-12px] border-l-2 border-slate-200" />
                    {/* Horizontal connector for last indent level */}
                    {i === level - 1 && (
                      <span className="absolute left-[8px] top-[50%] w-[10px] border-t-2 border-slate-200" />
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Chevron toggle */}
            <div className="shrink-0 w-4 flex items-center justify-center mt-0.5">
              {hasChildren ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggle(row.id); }}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : null}
            </div>

            {/* Status icon */}
            <div className="shrink-0 mt-0.5">
              {getTrailStatusIcon(row.status, isInactive)}
            </div>

            {/* Kind icon */}
            <div className="shrink-0 mt-0.5">
              {getExecutionRowKindIcon(row.kind, isInactive)}
            </div>

            {/* Label + sub-label */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[12px] font-bold leading-tight ${isInactive ? 'text-slate-400' : 'text-slate-800'}`}>
                  {row.label}
                </span>
                {/* Rework badge */}
                {typeof row.reworkedCount === 'number' && row.reworkedCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[9px] font-bold text-purple-700 whitespace-nowrap leading-none">
                    Reworked ×{row.reworkedCount}
                  </span>
                )}
              </div>
              {/* Robot Job ID sub-label for automation rows */}
              {row.kind === 'automation' && row.robotJobId && (
                <p className="text-[10px] text-slate-400 font-medium mt-0.5 truncate">
                  Robot Job {row.robotJobId}
                </p>
              )}
            </div>
          </div>
        </td>

        {/* Column 2: Ended At */}
        <td className="px-3 py-2.5 text-right">
          <span className={`text-[11px] ${isInactive ? 'text-slate-300' : 'text-slate-500'}`}>
            {isInactive || !row.endedAt ? '—' : formatDateTime(row.endedAt)}
          </span>
        </td>
      </tr>
    );

    if (!hasChildren || !isExpanded) {
      return [currentRow];
    }

    return [
      currentRow,
      ...renderExecutionTrailRows({
        rows: row.children || [],
        expandedRows,
        selectedRowId,
        rowRefs,
        onToggle,
        onSelect,
        level: level + 1,
        parentIsLast: isLast,
      }),
    ];
  });
}

function extractCaseJsonVariables(caseDefinition: any) {
  const normalizeEntries = (source: any): Array<{ key: string; value: string; elementId?: string }> => {
    if (!source) return [];

    if (Array.isArray(source)) {
      return source
        .filter(Boolean)
        .map((item: any) => ({
          key: String(item?.name || item?.displayName || item?.key || item?.id || 'Unnamed'),
          value:
            item?.value !== undefined
              ? stringifyVariable(item.value)
              : item?.defaultValue !== undefined
                ? stringifyVariable(item.defaultValue)
                : item?.body !== undefined
                  ? stringifyVariable(item.body)
                  : item?.type !== undefined
                    ? String(item.type)
                    : '—',
          elementId: item?.elementId ? String(item.elementId) : item?.id ? String(item.id) : undefined,
        }))
        .filter((entry) => entry.value !== '—');
    }

    if (typeof source === 'object') {
      return Object.entries(source).map(([key, value]: [string, any]) => ({
        key,
        value: stringifyVariable(value),
        elementId:
          value?.elementId
            ? String(value.elementId)
            : value?.id
              ? String(value.id)
              : value?.data?.elementId
                ? String(value.data.elementId)
                : undefined,
      }));
    }

    return [];
  };

  const candidatePaths = [
    caseDefinition?.root?.data?.uipath?.variables?.inputOutputs,
    caseDefinition?.root?.data?.uipath?.variables?.inputs,
    caseDefinition?.root?.data?.uipath?.variables?.outputs,
    caseDefinition?.root?.data?.uipath?.variables,
    caseDefinition?.data?.uipath?.variables?.inputOutputs,
    caseDefinition?.data?.uipath?.variables,
    caseDefinition?.variables,
  ];

  for (const candidate of candidatePaths) {
    const normalized = normalizeEntries(candidate);
    if (normalized.length) return normalized;
  }

  return [] as Array<{ key: string; value: string; elementId?: string }>;
}

function stringifyVariable(value: unknown) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getTaskVariables(
  caseJson: CaseJsonResponse | null,
  taskId?: string,
  definitionElementId?: string
): CaseJsonVariable[] {
  if (!caseJson || !taskId && !definitionElementId) return [];

  const variables: CaseJsonVariable[] = [];
  const searchId = (taskId || definitionElementId || '').toLowerCase();

  // Search through nodes' tasks for matching element
  const nodes = caseJson.nodes ?? [];
  for (const node of nodes) {
    const taskGroups = node.data?.tasks ?? [];
    for (const taskGroup of taskGroups) {
      for (const task of taskGroup) {
        const taskElementId = String(task?.elementId || task?.id || '').toLowerCase();
        if (taskElementId === searchId) {
          // Found matching task - collect its inputs and outputs
          const inputs = task.data?.inputs ?? [];
          const outputs = task.data?.outputs ?? [];
          
          for (const input of inputs) {
            variables.push({
              id: input.id || input.var || '',
              name: `[INPUT] ${input.displayName || input.name}`,
              type: input.type,
              elementId: input.elementId,
              value: input.value,
              body: input,
            });
          }
          
          for (const output of outputs) {
            variables.push({
              id: output.id || output.var || '',
              name: `[OUTPUT] ${output.displayName || output.name}`,
              type: output.type,
              elementId: output.elementId,
              value: output.value,
              body: output,
            });
          }
          
          console.log(`[Variables] Found ${variables.length} variables for task ${taskElementId}`);
          return variables;
        }
      }
    }
  }

  console.log(`[Variables] No variables found for task ${searchId}`);
  return variables;
}

function extractIncidents(elementExecutions: any[]) {
  return elementExecutions
    .filter((execution) => /fail|error/i.test(String(execution?.status || '')))
    .map((execution, index) => ({
      id: execution.elementId || `incident-${index}`,
      stageId: execution.caseStageElementId || execution.stageId,
      taskId: execution.elementId,
      title: execution.elementName || 'Execution incident',
      message: `Status: ${execution.status || 'Failed'}`,
      timeLabel: formatDateTime(execution.completedTime || execution.startedTime),
    }));
}

function getScopedVariables(
  variables: Array<{ key: string; value: string; elementId?: string }>,
  rows: ExecutionTrailNode[],
  selectedRowId: string | null,
  stages: any[],
  caseDefinition: any,
) {
  const selected = findSelectedTrailRow(rows, selectedRowId);
  if (!selected) return variables;

  if (selected.kind === 'stage') {
    const stageId = selected.stageId || selected.nodeId?.replace(/^stage-/, '');
    const stageNode = (caseDefinition?.nodes ?? []).find((node: any) => node.id === stageId);
    const stageElementIds = ((stageNode?.data?.tasks ?? []) as any[])
      .flat()
      .map((task: any) => String(task?.elementId || task?.id || ''))
      .filter(Boolean);

    return variables.filter((entry) => !entry.elementId || stageElementIds.includes(entry.elementId));
  }

  const definitionElementId = selected.definitionElementId || selected.taskId;

  if (definitionElementId) {
    const matching = variables.filter((entry) => entry.elementId === definitionElementId);
    return matching.length ? matching : variables;
  }

  return variables;
}

function filterIncidentsBySelection(
  incidents: Array<{ id: string; title: string; message: string; timeLabel: string; stageId?: string; taskId?: string }>,
  rows: ExecutionTrailNode[],
  selectedRowId: string | null,
) {
  const selected = findSelectedTrailRow(rows, selectedRowId);
  if (!selected) return incidents;
  if (selected.kind === 'stage') {
    return incidents.filter((incident) => incident.stageId === selected.stageId || incident.stageId === selected.nodeId?.replace(/^stage-/, ''));
  }
  return incidents.filter((incident) => {
    if (selected.definitionElementId) {
      return incident.taskId === selected.definitionElementId || incident.taskId === selected.taskId || incident.stageId === selected.stageId;
    }
    return incident.taskId === selected.taskId || incident.stageId === selected.stageId;
  });
}

function buildSelectedDetails(selectedRow: ExecutionTrailNode | null, stages: any[]) {
  if (!selectedRow) return [] as Array<[string, string]>;

  if (selectedRow.kind === 'stage') {
    const stage = stages.find((entry: any) => entry.id === selectedRow.stageId || entry.id === selectedRow.nodeId?.replace(/^stage-/, ''));
    return [
      ['Type', 'Stage'],
      ['Name', selectedRow.label],
      ['Status', selectedRow.status],
      ['Stage ID', String(stage?.id || selectedRow.stageId || '—')],
      ['Tasks', String((stage?.tasks ?? []).flat().length || 0)],
    ];
  }

  return [
    ['Type', selectedRow.kind],
    ['Name', selectedRow.label],
    ['Status', selectedRow.status],
    ['Stage ID', String(selectedRow.stageId || '—')],
    ['Task ID', String(selectedRow.taskId || '—')],
    ['Ended At', formatDateTime(selectedRow.endedAt)],
  ];
}

// ── Button Visibility Helpers ───────────────────────────────────────────────

function shouldShowPauseButton(instance: any): boolean {
  // Show when instance is running or not cancelled/case not closed
  const latestRunStatus = String(instance?.latestRunStatus || '').toLowerCase();
  const completedTime = instance?.completedTime;
  
  // Hide if cancelled or completed
  if (latestRunStatus.includes('cancelled') || completedTime) {
    return false;
  }
  
  // Show if running or paused
  return latestRunStatus.includes('running') || latestRunStatus.includes('paused');
}

function shouldShowResumeButton(instance: any): boolean {
  // Show only when instance is paused
  const latestRunStatus = String(instance?.latestRunStatus || '').toLowerCase();
  return latestRunStatus.includes('paused');
}

function shouldShowCancelButton(instance: any): boolean {
  // Show in every scenario EXCEPT: cancelled, closed, or completed
  const latestRunStatus = String(instance?.latestRunStatus || '').toLowerCase();
  const completedTime = instance?.completedTime;
  
  // Hide if already cancelled or completed
  if (latestRunStatus.includes('cancelled') || completedTime) {
    return false;
  }
  
  return true;
}

function shouldShowReopenButton(instance: any): boolean {
  // Show only when case status is "Completed"
  const latestRunStatus = String(instance?.latestRunStatus || '').toLowerCase();
  
  return latestRunStatus.includes('completed');
}

// ── Helper Components ───────────────────────────────────────────────────────

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'indigo' | 'amber' | 'emerald' }) {
  const toneClasses = {
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
  };

  return (
    <div className={`rounded-2xl border p-5 ${toneClasses[tone]}`}>
      <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-3 text-2xl font-black">{value || '—'}</p>
    </div>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string | undefined]> }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-5 bg-white">
      <h4 className="text-sm font-black uppercase tracking-widest text-slate-700 mb-4">{title}</h4>
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
            <span className="text-sm font-bold text-slate-700 text-right">{value || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  loading,
  subtle,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  loading?: boolean;
  subtle?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
        danger
          ? 'bg-red-600 text-white'
          : subtle
            ? 'border border-slate-200 bg-white text-slate-700'
            : 'bg-blue-600 text-white'
      }`}
    >
      {loading ? 'Working...' : label}
    </button>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function CaseTracesTab({
  caseBundle,
  refreshCaseData,
  isMutating,
  feedback,
  error,
  traceWarning,
  operationComment,
  setOperationComment,
  selectedReopenStageId,
  setSelectedReopenStageId,
  runCaseOperation,
  sdk,
}: CaseTracesTabProps) {
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | null>(null);
  const [selectedTrailRowId, setSelectedTrailRowId] = useState<string | null>(null);
  const [expandedExecutionRows, setExpandedExecutionRows] = useState<Record<string, boolean>>({});
  const [detailsTab, setDetailsTab] = useState<'details' | 'globalVariables' | 'incidents'>('details');
  const [variablesSearch, setVariablesSearch] = useState('');
  const [caseJsonVariables, setCaseJsonVariables] = useState<CaseJsonVariable[]>([]);
  const [caseJsonLoading, setCaseJsonLoading] = useState(false);
  const [selectedExecutionDetails, setSelectedExecutionDetails] = useState<any>(null);
  const [autoPolling, setAutoPolling] = useState(true);
  const executionRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const caseSummary = getCaseHealthSummary(
    caseBundle?.instance ?? null,
    caseBundle?.stages ?? [],
    caseBundle?.executionHistory ?? null,
    caseBundle?.actionTasks ?? [],
  );
  const flattenedStageTasks = flattenStageTasks(caseBundle?.stages ?? []);
  const orchestrationCanvas = useMemo(
    () => buildProcessCanvas(
      caseBundle?.stages ?? [],
      caseBundle?.caseDefinition ?? null,
      caseBundle?.executionHistory ?? null,
    ),
    [caseBundle?.stages, caseBundle?.caseDefinition, caseBundle?.executionHistory],
  );
  const executionTrailRows = useMemo(
    () => buildExecutionTrailRows(
      orchestrationCanvas.nodes,
      caseBundle?.executionHistory?.elementExecutions ?? [],
    ),
    [orchestrationCanvas.nodes, caseBundle?.executionHistory?.elementExecutions],
  );
  const executionTrailIndex = useMemo(
    () => indexExecutionTrailRows(executionTrailRows),
    [executionTrailRows],
  );
  const highlightedCanvasNodes = useMemo(
    () => orchestrationCanvas.nodes.map((node) => ({ ...node, selected: node.id === selectedCanvasNodeId })),
    [orchestrationCanvas.nodes, selectedCanvasNodeId],
  );
  const globalVariables = useMemo(
    () => extractCaseJsonVariables(caseBundle?.caseDefinition ?? null),
    [caseBundle?.caseDefinition],
  );
  const selectedExecutionRow = useMemo(
    () => findSelectedTrailRow(executionTrailRows, selectedTrailRowId),
    [executionTrailRows, selectedTrailRowId],
  );

  // Get task-specific variables from case JSON
  const taskVariables = useMemo(() => {
    if (!selectedExecutionRow || selectedExecutionRow.kind === 'stage' || caseJsonVariables.length === 0) {
      console.log('[Variables] No task selected, is a stage, or no variables available');
      return [];
    }
    
    // Filter variables for the selected task using its definitionElementId
    const filteredVars = caseJsonVariables.filter((v: any) => {
      // Match by taskElementId or taskId from the variable, or by elementId if no task ID
      if (selectedExecutionRow.definitionElementId) {
        return v.taskElementId === selectedExecutionRow.definitionElementId || 
               v.elementId === selectedExecutionRow.definitionElementId ||
               !v.taskElementId; // Include global variables if no task-specific ones exist
      }
      return true;
    });

    console.log('[Variables] Task variables filtered:', filteredVars.length, 'items for task', selectedExecutionRow.definitionElementId);
    return filteredVars;
  }, [selectedExecutionRow, caseJsonVariables]);

  const filteredGlobalVariables = useMemo(
    () => {
      const scoped = getScopedVariables(
        globalVariables,
        executionTrailRows,
        selectedTrailRowId,
        caseBundle?.stages ?? [],
        caseBundle?.caseDefinition ?? null,
      );
      return scoped.filter((entry) => entry.key.toLowerCase().includes(variablesSearch.toLowerCase()));
    },
    [globalVariables, executionTrailRows, selectedTrailRowId, caseBundle?.stages, caseBundle?.caseDefinition, variablesSearch],
  );
  const incidents = useMemo(
    () => extractIncidents(caseBundle?.executionHistory?.elementExecutions ?? []),
    [caseBundle?.executionHistory?.elementExecutions],
  );
  const filteredIncidents = useMemo(
    () => filterIncidentsBySelection(incidents, executionTrailRows, selectedTrailRowId),
    [incidents, executionTrailRows, selectedTrailRowId],
  );

  // Fetch case-json for variables
  useEffect(() => {
    const loadCaseJson = async () => {
      if (!caseBundle?.instance?.instanceId) return;
      
      setCaseJsonLoading(true);
      try {
        const baseUrl = import.meta.env.VITE_UIPATH_BASE_URL;
        const orgName = import.meta.env.VITE_UIPATH_ORG_NAME;
        const tenantName = import.meta.env.VITE_UIPATH_TENANT_NAME;
        
        const caseJson = await fetchCaseJson(
          {} as any,
          {
            businessCaseId: caseBundle.instance.instanceId,
            folderKey: caseBundle.instance.folderKey || '',
            baseUrl,
            orgName,
            tenantName,
          }
        );
        
        if (caseJson) {
          const variables = extractVariablesFromCaseJson(caseJson);
          setCaseJsonVariables(variables);
          console.log('Case JSON Variables:', variables);
        }
      } catch (err) {
        console.error('Failed to fetch case-json:', err);
      } finally {
        setCaseJsonLoading(false);
      }
    };
    
    loadCaseJson();
  }, [caseBundle?.instance?.instanceId]);

  // Build execution trail from execution history (only executed items)
  const executionHistoryTrailRows = useMemo(() => {
    const elementExecutions = caseBundle?.executionHistory?.elementExecutions ?? [];
    if (!elementExecutions.length) return [];
    
    // Sort by startedTime
    const sorted = [...elementExecutions].sort((a, b) => {
      const aTime = new Date(a.startedTime ?? 0).getTime();
      const bTime = new Date(b.startedTime ?? 0).getTime();
      return aTime - bTime;
    });
    
    return sorted.map((execution, index) => ({
      id: `exec-${execution.elementId}-${index}`,
      elementId: execution.elementId,
      elementName: execution.elementName,
      status: execution.status,
      startedTime: execution.startedTime,
      completedTime: execution.completedTime,
      processKey: execution.processKey,
      externalLink: execution.externalLink,
      parentElementId: execution.parentElementId,
      elementRuns: execution.elementRuns,
    }));
  }, [caseBundle?.executionHistory?.elementExecutions]);

  // Get variables for selected execution
  const selectedExecutionVariables = useMemo(() => {
    if (!selectedTrailRowId || !caseJsonVariables.length) return caseJsonVariables;
    
    const selectedExec = executionHistoryTrailRows.find(r => r.id === selectedTrailRowId);
    if (!selectedExec) return caseJsonVariables;
    
    return getVariablesForElement(caseJsonVariables, selectedExec.elementId);
  }, [selectedTrailRowId, caseJsonVariables, executionHistoryTrailRows]);

  // Get selected execution details
  const selectedExecDetails = useMemo(() => {
    if (!selectedTrailRowId) return null;
    return executionHistoryTrailRows.find(r => r.id === selectedTrailRowId) || null;
  }, [selectedTrailRowId, executionHistoryTrailRows]);

  // ── Smart Polling: Auto-refresh every 5s when case is running ─────────────
  useEffect(() => {
    refreshCaseData();

    if (!autoPolling) return;

    const interval = setInterval(() => {
      const status = caseBundle?.instance?.latestRunStatus?.toLowerCase();
      if (status === 'running' || status === 'inprogress' || status === 'paused') {
        refreshCaseData();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [caseBundle?.instance?.instanceId, caseBundle?.instance?.latestRunStatus, autoPolling]);

  useEffect(() => {
    if (!selectedTrailRowId) return;
    const rowEl = executionRowRefs.current[selectedTrailRowId];
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedTrailRowId]);

  const handleCanvasNodeClick = (_: unknown, node: Node) => {
    setSelectedCanvasNodeId(node.id);
    const indexed = executionTrailIndex.get(node.id);
    if (!indexed) return;
    setSelectedTrailRowId(indexed.id);
    if (indexed.parentIds.length) {
      setExpandedExecutionRows((prev) => {
        const next = { ...prev };
        indexed.parentIds.forEach((parentId) => {
          next[parentId] = true;
        });
        return next;
      });
    }
  };

  const handleExecutionRowClick = (exec: typeof executionHistoryTrailRows[0]) => {
    setSelectedTrailRowId(exec.id);
    setSelectedExecutionDetails(exec);
  };

  // Check if we have any meaningful data to display
  const hasNoData = !caseBundle || (
    !caseBundle.instance && 
    (!caseBundle.stages || caseBundle.stages.length === 0) && 
    !caseBundle.executionHistory &&
    (!caseBundle.actionTasks || caseBundle.actionTasks.length === 0)
  );

  const hasApiErrors = caseBundle?.warnings && caseBundle.warnings.length > 0;

  return (
    <div className="space-y-8">
      {/* API Error Banner */}
      {hasApiErrors && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
            <div>
              <h4 className="text-sm font-bold text-amber-800 mb-2">Data Loading Issues Detected</h4>
              <ul className="space-y-1">
                {caseBundle?.warnings?.map((warning, idx) => (
                  <li key={idx} className="text-sm text-amber-700 flex items-start gap-2">
                    <span className="text-amber-500 mt-1">•</span>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-600 mt-3">
                The case trace may display incomplete information. Click "Refresh Trace" to retry loading the data.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <XCircle className="text-red-600 shrink-0 mt-0.5" size={20} />
            <div>
              <h4 className="text-sm font-bold text-red-800">Error Loading Case Trace</h4>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-700">
          {feedback}
        </div>
      )}

      {traceWarning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-700">
          {traceWarning}
        </div>
      )}

      {/* No Data State */}
      {hasNoData && !error && (
        <div className="rounded-2xl border border-slate-200 bg-white p-12">
          <div className="text-center max-w-md mx-auto">
            <div className="flex justify-center mb-6">
              <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center">
                <AlertCircle className="text-slate-400" size={32} />
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">No Case Trace Data Available</h3>
            <p className="text-sm text-slate-500 mb-6">
              Unable to load case trace information. This could be due to:
            </p>
            <ul className="text-sm text-slate-500 text-left space-y-2 mb-6">
              <li className="flex items-start gap-2">
                <span className="text-slate-400 mt-0.5">•</span>
                <span>The case has not been created in UiPath yet</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-400 mt-0.5">•</span>
                <span>Network connectivity issues or API timeout</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-400 mt-0.5">•</span>
                <span>Insufficient permissions to access case data</span>
              </li>
            </ul>
            <button
              onClick={refreshCaseData}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 transition-colors"
            >
              <RotateCw size={16} />
              Refresh Case Trace
            </button>
          </div>
        </div>
      )}

      {/* Main Content - Only render when we have data */}
      {!hasNoData && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <MetricCard label="Current Run Status" value={caseSummary.latestRunStatus} tone="blue" />
            <MetricCard label="Current Stage" value={caseSummary.currentStage?.name || 'Not available'} tone="indigo" />
            <MetricCard label="Pending Tasks" value={String(caseSummary.pendingTasksCount)} tone="amber" />
            <MetricCard label="Completed Stages" value={`${caseSummary.completedStages}/${caseSummary.totalStages}`} tone="emerald" />
          </section>

          <section className="bg-slate-50 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Case Management Orchestration Canvas</h3>
                  {hasApiErrors && (
                    <p className="text-xs text-amber-600 font-semibold mt-1 flex items-center gap-1">
                      <AlertCircle size={12} />
                      Showing partial data - some information may be missing
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {/* Auto-Polling Toggle */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600">Auto-refresh</span>
                    <button
                      onClick={() => setAutoPolling(!autoPolling)}
                      className="flex items-center gap-1 transition-colors"
                    >
                      {autoPolling ? (
                        <ToggleRight size={24} className="text-blue-600" />
                      ) : (
                        <ToggleLeft size={24} className="text-slate-400" />
                      )}
                    </button>
                    {!autoPolling && (
                      <button
                        onClick={refreshCaseData}
                        disabled={isMutating}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={isMutating ? 'animate-spin' : ''} />
                        Refresh
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid h-[860px] grid-rows-[3fr_2fr] bg-slate-50">
              <div className="min-h-0 bg-slate-50">
                {orchestrationCanvas.nodes.length > 0 ? (
                  <ReactFlow
                    nodes={highlightedCanvasNodes}
                    edges={orchestrationCanvas.edges}
                    nodeTypes={processNodeTypes}
                    fitView
                    minZoom={0.45}
                    maxZoom={1.4}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={true}
                    panOnScroll
                    onNodeClick={handleCanvasNodeClick}
                    onPaneClick={() => {
                      setSelectedCanvasNodeId(null);
                      setSelectedTrailRowId(null);
                    }}
                    proOptions={{ hideAttribution: true }}
                    defaultEdgeOptions={{
                      type: 'step',
                      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
                      style: { stroke: '#64748b', strokeWidth: 2.2 },
                    }}
                  >
                    <Background variant={BackgroundVariant.Dots} color="#cbd5e1" gap={18} size={1.2} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                ) : (
                  <div className="flex items-center justify-center h-full bg-slate-50">
                    <div className="text-center p-8">
                      <div className="flex justify-center mb-4">
                        <div className="h-12 w-12 rounded-full bg-slate-200 flex items-center justify-center">
                          <AlertCircle className="text-slate-400" size={24} />
                        </div>
                      </div>
                      <h4 className="text-sm font-bold text-slate-600 mb-2">No Process Flow Available</h4>
                      <p className="text-xs text-slate-400 max-w-xs">
                        The case stages could not be loaded. This may be due to API errors or the case not having any stages defined yet.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid min-h-0 grid-cols-1 border-t border-slate-200 bg-white lg:grid-cols-2">
                <div className="border-r border-slate-200 overflow-y-auto flex flex-col">
                  <div className="px-5 py-4 border-b border-slate-100 sticky top-0 z-10 bg-white">
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-700">Hierarchical Execution Trail</h4>
                    <p className="text-[10px] text-slate-400 font-bold mt-1">
                      {executionTrailRows.length > 0 
                        ? `${executionTrailRows.length} stages with ${executionTrailRows.reduce((sum, stage) => sum + (stage.children?.length || 0), 0)} total steps`
                        : 'No execution data available'
                      }
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {executionTrailRows.length > 0 ? (
                      <div className="p-5">
                        <ExecutionTrail
                          rows={executionTrailRows}
                          selectedRowId={selectedTrailRowId}
                          onRowSelect={(row) => {
                            console.log('[ExecutionTrail] Row selected:', row);
                            setSelectedTrailRowId(row.id);
                            setSelectedExecutionDetails(undefined);
                          }}
                          onCanvasNodeClick={(nodeId) => {
                            setSelectedCanvasNodeId(nodeId);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full p-8">
                        <div className="text-center">
                          <div className="flex justify-center mb-3">
                            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                              <Clock3 className="text-slate-400" size={20} />
                            </div>
                          </div>
                          <p className="text-sm font-bold text-slate-500 mb-1">No Execution Trail</p>
                          <p className="text-xs text-slate-400">
                            Execution steps will appear here as the case progresses through its stages.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="overflow-y-auto">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 sticky top-0 z-10 bg-white">
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-700">Task Details & Variables</h4>
                    <div className="rounded-lg border border-slate-200 p-1 text-[10px] font-black uppercase tracking-widest">
                      <button
                        onClick={() => setDetailsTab('details')}
                        className={`px-3 py-1 rounded ${detailsTab === 'details' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                      >
                        Details
                      </button>
                      <button
                        onClick={() => setDetailsTab('globalVariables')}
                        className={`px-3 py-1 rounded ${detailsTab === 'globalVariables' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                      >
                        Variables ({taskVariables.length > 0 ? taskVariables.length : 0})
                      </button>
                      <button
                        onClick={() => setDetailsTab('incidents')}
                        className={`px-3 py-1 rounded ${detailsTab === 'incidents' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                      >
                        Incidents ({filteredIncidents.length})
                      </button>
                    </div>
                  </div>

                  {detailsTab === 'details' && (
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                      {selectedExecutionRow ? (
                        <>
                          <h5 className="text-[11px] font-black uppercase tracking-widest text-slate-700 mb-3">Selected {selectedExecutionRow.kind}</h5>
                          <div className="space-y-2 text-[11px]">
                            <div className="flex justify-between">
                              <span className="text-slate-500 font-bold">Name:</span>
                              <span className="text-slate-900 font-black">{selectedExecutionRow.label}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500 font-bold">Kind:</span>
                              <span className="text-slate-900 font-bold capitalize">{selectedExecutionRow.kind}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500 font-bold">Status:</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${getStatusPillClass(selectedExecutionRow.status)}`}>
                                {selectedExecutionRow.status}
                              </span>
                            </div>
                            {selectedExecutionRow.endedAt && (
                              <div className="flex justify-between">
                                <span className="text-slate-500 font-bold">Ended At:</span>
                                <span className="text-slate-900">{formatDateTime(selectedExecutionRow.endedAt)}</span>
                              </div>
                            )}
                            {selectedExecutionRow.reworkedCount && selectedExecutionRow.reworkedCount > 0 && (
                              <div className="flex justify-between">
                                <span className="text-slate-500 font-bold">Reworked:</span>
                                <span className="text-purple-700 font-bold">x{selectedExecutionRow.reworkedCount}</span>
                              </div>
                            )}
                            {selectedExecutionRow.robotJobId && (
                              <div className="flex justify-between">
                                <span className="text-slate-500 font-bold">Robot Job:</span>
                                <span className="text-slate-900 font-mono text-[10px]">{selectedExecutionRow.robotJobId}</span>
                              </div>
                            )}
                            {selectedExecutionRow.kind !== 'stage' && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-slate-500 font-bold">Task ID:</span>
                                  <span className="text-slate-900 font-mono text-[10px]">{selectedExecutionRow.taskId || '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500 font-bold">Element ID:</span>
                                  <span className="text-slate-900 font-mono text-[10px]">{selectedExecutionRow.definitionElementId || '—'}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-8 text-slate-400">
                          <p className="text-sm font-bold">Select a task or stage from the execution trail to view details</p>
                        </div>
                      )}
                    </div>
                  )}

                  {detailsTab === 'globalVariables' && (
                    <div className="p-4 space-y-3">
                      {selectedExecutionRow && selectedExecutionRow.kind !== 'stage' && taskVariables.length > 0 && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
                          ✓ Showing variables for <span className="text-emerald-900">{selectedExecutionRow.label}</span>
                        </div>
                      )}
                      {selectedExecutionRow && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
                          Scoped to <span className="text-slate-900">{selectedExecutionRow.label}</span>
                        </div>
                      )}
                      <input
                        value={variablesSearch}
                        onChange={(e) => setVariablesSearch(e.target.value)}
                        placeholder="Search variable by name"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-widest text-slate-400">
                            <th className="px-2 py-2">Name</th>
                            <th className="px-2 py-2">Direction</th>
                            <th className="px-2 py-2">Type</th>
                            <th className="px-2 py-2">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taskVariables
                            .filter((entry: any) => entry.name?.toLowerCase().includes(variablesSearch.toLowerCase()) || entry.key?.toLowerCase().includes(variablesSearch.toLowerCase()))
                            .map((entry: any, idx: number) => (
                            <tr key={`${entry.name || entry.key}-${idx}`} className="border-t border-slate-100 text-[10px]">
                              <td className="px-2 py-2 font-black text-slate-700">{entry.name || entry.key}</td>
                              <td className="px-2 py-2 text-slate-600">
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${entry.direction === 'input' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  [{entry.direction?.toUpperCase()}]
                                </span>
                              </td>
                              <td className="px-2 py-2 text-slate-600 font-mono text-[9px]">{entry.type || '—'}</td>
                              <td className="px-2 py-2 text-slate-600 font-mono text-[9px] max-w-[150px] truncate" title={stringifyVariable(entry.value || entry.defaultValue)}>{stringifyVariable(entry.value || entry.defaultValue)}</td>
                            </tr>
                          ))}
                          {taskVariables.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-2 py-4 text-center text-slate-400 text-[11px]">
                                {selectedExecutionRow ? 'No variables for this task' : 'Select a task to view variables'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {detailsTab === 'incidents' && (
                    <div className="p-4 space-y-3">
                      {filteredIncidents.length ? filteredIncidents.map((incident) => (
                        <div key={incident.id} className="rounded-xl border border-red-200 bg-red-50 p-3">
                          <p className="text-xs font-black uppercase tracking-widest text-red-700">{incident.title}</p>
                          <p className="text-sm font-bold text-red-600 mt-1">{incident.message}</p>
                          <p className="text-[11px] text-red-500 mt-2">{incident.timeLabel}</p>
                        </div>
                      )) : (
                        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm font-bold text-slate-400">
                          No incidents recorded.
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </div>
          </section>
        </>
      )}

      <section className="bg-white rounded-2xl border-2 border-slate-100 p-8 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div>
            <h3 className="text-lg font-black text-slate-900">Case Runtime Overview</h3>
            <p className="text-xs uppercase tracking-widest text-slate-400 font-black mt-1">
              Powered by CaseInstances.getById, getStages, getExecutionHistory, getActionTasks
            </p>
          </div>
          <button
            onClick={refreshCaseData}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 hover:border-blue-500 hover:text-blue-600"
          >
            Refresh Trace
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <InfoPanel
            title="Instance Identity"
            rows={[
              ['Instance ID', caseBundle?.instance?.instanceId],
              ['Display Name', caseBundle?.instance?.instanceDisplayName],
              ['Process Key', caseBundle?.instance?.processKey],
              ['Folder Key', caseBundle?.instance?.folderKey],
              ['Started By', caseBundle?.instance?.startedByUser],
              ['Started Time', formatDateTime(caseBundle?.instance?.startedTime)],
              ['Completed Time', formatDateTime(caseBundle?.instance?.completedTime)],
            ]}
          />

          <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
            <h4 className="text-sm font-black uppercase tracking-widest text-slate-700 mb-4">Case Controls</h4>
            <div className="space-y-3">
              <textarea
                value={operationComment}
                onChange={(e) => setOperationComment(e.target.value)}
                placeholder="Optional operation comment"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-blue-500"
                rows={3}
              />
              <div className="grid grid-cols-2 gap-3">
                {shouldShowPauseButton(caseBundle?.instance) && (
                  <ActionButton label="Pause" onClick={() => runCaseOperation('pause')} loading={isMutating} />
                )}
                {shouldShowResumeButton(caseBundle?.instance) && (
                  <ActionButton label="Resume" onClick={() => runCaseOperation('resume')} loading={isMutating} />
                )}
                {shouldShowCancelButton(caseBundle?.instance) && (
                  <ActionButton label="Cancel" onClick={() => runCaseOperation('close')} loading={isMutating} danger />
                )}
                <ActionButton label="Refresh" onClick={refreshCaseData} loading={isMutating} subtle />
              </div>
              {shouldShowReopenButton(caseBundle?.instance) && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Reopen from stage</label>
                  <select
                    value={selectedReopenStageId}
                    onChange={(e) => setSelectedReopenStageId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">Select a stage...</option>
                    {(caseBundle?.stages ?? []).map((stage: any) => (
                      <option key={stage.id} value={stage.id}>{stage.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => runCaseOperation('reopen')}
                    disabled={!selectedReopenStageId || isMutating}
                    className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    Reopen Case
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
