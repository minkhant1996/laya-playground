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
  raw?: number | null
  ms?: number | null
}

export interface EvalResult {
  question_type?: 'choice' | 'score' | 'noul'
  extra_metrics?: Record<string, number>
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
  | { type: 'status'; message: string; stage?: string; load_seconds?: number }
  | { type: 'start'; n: number; labels: string[]; criteria: Record<string, string>; engine: Engine }
  | { type: 'row'; i: number; n: number; row: EvalRow; accuracy: number; elapsed: number; eta: number; avg_ms: number; query_ms: number }
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
  plan?: PlanResult | null
  criteria?: Record<string, string> | null
}

export interface EvalPlan {
  state_columns: string[] | string | null
  label_column: string | null
  question: Question
  label_map: Record<string, string | number | boolean>
}

export interface PlanResult extends EvalPlan {
  dataset: string
  columns: string[]
  size: number
  label_values: string[]
  rationale: string
}

export interface LearnDoc {
  file: string
  title: string
  url: string
  summary: string
  chars: number
}

export interface LearnSource {
  n: number
  title: string
  url: string
  file: string
}

export interface LearnMsg {
  role: 'user' | 'assistant'
  content: string
  sources?: LearnSource[]
}

export interface I18nStatus {
  running: boolean
  done: number
  total: number
  current: string | null
  errors: number
  have: { learn: number; chat: number }
  languages: number
}

export interface EvalHistoryEntry {
  id: string
  kind: 'eval' | 'compare'
  title: string
  created: number
  dataset: string
  engine: string
  n: number | null
  accuracy: number | null
  accuracy_b: number | null
  avg_ms: number | null
  avg_ms_b: number | null
  question_type: string | null
}

export interface EvalHistoryFull extends EvalHistoryEntry {
  result: EvalResult
  result_b: EvalResult | null
  label_a: string | null
  label_b: string | null
}

export interface SystemInfo {
  process: { rss_mb: number; cpu_percent: number }
  ram: { total_mb: number; used_mb: number; percent: number }
  cpu_percent: number
  gpus: { index: number; name: string; total_mb: number; used_mb: number; process_mb: number | null }[]
  laya_loaded: boolean
  laya_device: string
  os: string
  note: string | null
}
