export type QuestionType = 'choice' | 'score' | 'noul'

export interface Question {
  type: QuestionType
  instructions: string
  criteria?: Record<string, string> | string[]
}

export type Questions = Record<string, Question>
export type State = string | Record<string, unknown>

export interface Answer {
  type: QuestionType
  choice?: string
  score?: number
  noul?: number
  confidence?: number
  probabilities?: Record<string, number>
  [k: string]: unknown
}

export interface PredictResult {
  answers: Record<string, Answer>
  routing?: { model: string; repo: string; reason: string }
  [k: string]: unknown
}

export interface DatasetInfo {
  id: string
  name: string
  path: string
  config: string | null
  text_column: string
  label_column: string
  description: string
}

export interface EvalRow {
  text: string
  gold: string
  pred: string
  confidence: number | null
  correct: boolean
}

export interface EvalResult {
  shortlist_k?: number | null
  dataset_id: string
  n: number
  accuracy: number
  labels: string[]
  criteria: Record<string, string>
  routing: PredictResult['routing'] | null
  rows: EvalRow[]
  per_label: Record<string, { n: number; accuracy: number }>
}

export interface DatasetSource {
  kind: 'preset' | 'hf' | 'upload' | 'kaggle'
  dataset_id?: string
  path?: string
  config?: string | null
  upload_id?: string
  file?: string
  header?: boolean
  text_column?: string | null
  label_column?: string | null
}

export interface InspectResult {
  path: string
  config?: string | null
  configs: string[]
  needs_config: boolean
  splits?: string[]
  default_split?: string
  columns?: string[]
  text_column?: string | null
  label_column?: string | null
  size?: number
  labels?: string[]
  preview?: Record<string, unknown>[]
}

export interface UploadResult {
  upload_id: string
  filename: string
  size: number
  columns: string[]
  text_column: string | null
  label_column: string | null
  labels: string[]
  preview: Record<string, unknown>[]
}

export interface Engine {
  kind: 'laya' | 'jev'
  model?: string | null
}

export interface ORModel {
  id: string
  name: string
  context: number | null
  prompt_price: number
  completion_price: number
  structured: boolean
}

export interface UsageBucket {
  key?: string
  calls: number
  errors: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  avg_latency_ms: number
}

export interface UsageEntry {
  ts: number
  purpose: string
  engine: string
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  latency_ms: number | null
  ok: boolean
  error?: string | null
  questions?: number
}

export interface UsageSummary {
  total: UsageBucket
  by_model: UsageBucket[]
  by_purpose: UsageBucket[]
  by_day: UsageBucket[]
  recent: UsageEntry[]
}

export type EvalEvent =
  | { type: 'status'; message: string }
  | { type: 'start'; n: number; labels: string[]; criteria: Record<string, string>; engine: Engine }
  | { type: 'row'; i: number; n: number; row: EvalRow; accuracy: number; elapsed: number; eta: number }
  | { type: 'done'; result: EvalResult }
  | { type: 'error'; message: string }

export interface ChatTurn {
  reply: string
  spec: { state: State; questions: Questions } | null
  result: PredictResult | null
  explanation: string | null
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  ts?: number
  spec?: { state: State; questions: Questions } | null
  result?: PredictResult | null
}

export interface ChatSessionSummary {
  id: string
  title: string
  created: number
  updated: number
  count: number
  engine?: Engine | null
}

export interface ChatSession extends ChatSessionSummary {
  messages: ChatMsg[]
}

export interface KaggleInspect {
  path: string
  files: { file: string; size_kb: number }[]
  file: string
  header: boolean
  columns: string[]
  text_column: string | null
  label_column: string | null
  size: number
  labels: string[]
  preview: Record<string, unknown>[]
}

export interface LibraryEntry extends DatasetSource {
  id: string
  name: string
  size: number | null
  labels: number | null
  last_used: number
  split?: string | null
}
