// WorkflowState — type definition (stub)
export interface WorkflowState {
  workflowId: string;
  sessionId: string;
  parentSessionId: string;
  status: 'running' | 'completed' | 'error' | 'undone' | 'cancelled';
  result?: string;
  error?: string;
  startedAt: number;
  agent: string;
}

// ApiMode — type definition (stub)
export type ApiMode = 'promptAsync';

// LaunchArgs — type definition (stub)
export interface LaunchArgs {
  workflowId: string;
  oPrompt: string;
  agent: string;
  parentSessionId: string;
  targetSessionId?: string;
  focusHint?: string;
}

// LaunchResult — type definition (stub)
export interface LaunchResult {
  workflow_id: string;
  session_id: string;
  status: 'running' | 'error';
  message: string;
}
