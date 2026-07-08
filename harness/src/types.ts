export interface Segment {
  index: number;
  startMs: number;
  endMs: number;
  score?: number;
}

export interface SegmentsMeta {
  tool: string;
  version?: string;
  params?: Record<string, unknown>;
  input: string;
  inputSha256: string;
  elapsedMs: number;
  durationMs: number;
}

export interface SegmentsDocument {
  meta: SegmentsMeta;
  segments: Segment[];
}

// Shape of each adapters/<name>/adapter.json.
export interface Adapter {
  name: string;
  run: string[];
  cwd: string;
}
