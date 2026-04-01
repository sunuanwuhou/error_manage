export type AnalysisMode = 'rule' | 'ai' | 'hybrid';

export type ErrorTypePrimary =
  | '审题错误'
  | '概念错误'
  | '公式错误'
  | '计算错误'
  | '推理断裂'
  | '选项排除错误'
  | '时间分配错误'
  | '表达不完整'
  | '过程缺失无法定位';

export interface TriggerEvidence {
  code: string;
  label: string;
  message: string;
  source: 'answer' | 'process' | 'score' | 'manual';
}

export interface ErrorAnalysisRecord {
  analysisId: string;
  questionId: string;
  attemptId: string;
  scoreId: string;
  processIds: string[];
  isWrong: boolean;
  scoreStatus: 'correct' | 'wrong' | 'partial' | 'review_required';
  confidence: number;
  errorTypePrimary: ErrorTypePrimary;
  errorTypeSecondary: string[];
  rootCause: string;
  triggerEvidence: TriggerEvidence[];
  wrongStepIndex?: number;
  wrongStepText?: string;
  nextAction: string;
  retryRecommended: boolean;
  reviewKnowledgeNodeIds: string[];
  reviewNoteIds: string[];
  trainingMode: 'redo_same_question' | 'variant_training' | 'same_error_training' | 'note_review' | 'process_replay';
  analysisVersion: number;
  analysisMode: AnalysisMode;
  generatedAt: string;
  generatedBy: string;
}
