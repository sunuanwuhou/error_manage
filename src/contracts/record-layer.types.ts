export type ModuleType = '言语' | '判断' | '数量' | '资料' | '公基' | '申论';
export type QuestionType = 'single_choice' | 'multi_choice' | 'blank' | 'calculation' | 'sorting' | 'matching' | 'subjective';
export type AnswerStructure = 'choice' | 'text' | 'number' | 'multi_part' | 'subjective';
export type SourceType = 'past_exam' | 'manual_entry' | 'imported_doc' | 'imported_image' | 'generated_variant';

export interface QuestionRecord {
  questionId: string;
  module: ModuleType;
  questionType: QuestionType;
  answerStructure: AnswerStructure;
  stem: string;
  materials?: string[];
  options?: Array<{ key: string; text: string }>;
  standardAnswer: unknown;
  sourceType: SourceType;
  sourceMeta: Record<string, unknown>;
  knowledgeNodeIds: string[];
  noteIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AttemptRecord {
  attemptId: string;
  questionId: string;
  userAnswer: unknown;
  normalizedAnswer: unknown;
  answerMeta: Record<string, unknown>;
  processSessionIds: string[];
  status: 'drafting' | 'submitted' | 'scored' | 'analyzed' | 'reviewed';
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreRecord {
  scoreId: string;
  questionId: string;
  attemptId: string;
  isCorrect: boolean;
  scoreValue: number;
  maxScore: number;
  scoreStatus: 'correct' | 'wrong' | 'partial' | 'review_required';
  judgeMode: 'rule' | 'manual' | 'ai' | 'hybrid';
  judgeSummary: string;
  createdAt: string;
}

export type ReviewTrainingMode = 'redo_same_question' | 'variant_training' | 'same_error_training' | 'note_review' | 'process_replay';

export interface ReviewTaskRecord {
  reviewTaskId: string;
  questionId: string;
  attemptId?: string;
  analysisId?: string;
  sourceAttemptId?: string;
  sourceAnalysisId?: string;
  taskType?: ReviewTrainingMode;
  trainingMode?: ReviewTrainingMode;
  title?: string;
  description?: string;
  status: 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'ignored';
  priority: number;
  createdAt: string;
  updatedAt: string;
}
