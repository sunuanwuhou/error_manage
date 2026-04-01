export interface ProcessSessionRecord {
  processSessionId: string;
  questionId: string;
  attemptId: string;
  startedAt: string;
  endedAt?: string;
  deviceMeta?: Record<string, unknown>;
  derivedMeta?: Record<string, unknown>;
}

export interface StrokePoint {
  x: number;
  y: number;
  t: number;
  pressure?: number;
}

export interface StrokeRecord {
  strokeId: string;
  processSessionId: string;
  color: string;
  width: number;
  points: StrokePoint[];
  createdAt: string;
}

export interface ProcessEventRecord {
  eventId: string;
  processSessionId: string;
  eventType: 'create' | 'clear' | 'undo' | 'redo' | 'insert_text' | 'highlight' | 'snapshot';
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface ProcessSnapshotRecord {
  snapshotId: string;
  processSessionId: string;
  stage: 'checkpoint' | 'before_submit' | 'before_analysis' | 'manual';
  blobRef: string;
  createdAt: string;
}
