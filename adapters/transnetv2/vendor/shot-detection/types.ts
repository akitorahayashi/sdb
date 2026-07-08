export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec?: string;
}

export interface ShotBoundary {
  frameIndex: number;
  timestampMs: number;
  confidence: number;
}

export interface ShotSegment {
  index: number;
  startMs: number;
  endMs: number;
}

export interface DetectionResult {
  boundaries: ShotBoundary[];
  shots: ShotSegment[];
  totalFrames: number;
  fps: number;
  durationMs: number;
}

export interface ShotDetectorOptions {
  modelPath?: string;
  threshold?: number;
  minShotDurationMs?: number;
  modelCacheDir?: string;
  modelUrl?: string;
}

export interface DetectShotsOptions extends ShotDetectorOptions {
  videoPath: string;
}
