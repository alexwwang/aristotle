// WorkflowState — core type definition
export interface WorkflowState {
  workflowId: string;
  sessionId: string;
  parentSessionId: string;
  status: 'running' | 'chain_pending' | 'completed' | 'error' | 'chain_broken' | 'undone' | 'cancelled';
  result?: string;
  error?: string;
  startedAt: number;
  agent: string;
  instanceId?: string;
}

// ApiMode — core type definition
export type ApiMode = 'promptAsync';

// CoreLaunchArgs — DC-01/DC-02 core launch arguments
export interface CoreLaunchArgs {
  oPrompt: string;
  parentSessionId: string;
  title: string;
  onSessionCreated?: (sessionId: string) => void;
}

// CoreLaunchResult — DC-01/DC-02 core launch result
export interface CoreLaunchResult {
  sessionId: string;
  status: 'running' | 'error';
  message: string;
}

// LaunchArgs — bridge/agent launch arguments (retained for aristotle compatibility)
export interface LaunchArgs {
  workflowId: string;
  oPrompt: string;
  agent: string;
  parentSessionId: string;
  targetSessionId?: string;
  focusHint?: string;
}

// LaunchResult — bridge/agent launch result (retained for aristotle compatibility)
export interface LaunchResult {
  workflow_id: string;
  session_id: string;
  status: 'running' | 'error';
  message: string;
}
