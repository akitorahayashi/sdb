import { ShotDetectionError } from './errors';
import { extractLowResRgbFrames, MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH, probeVideo } from './ffmpeg';
import { MODEL_INPUT_CHANNELS, MODEL_INPUT_SIZE, TransNetV2ONNX, WINDOW_SIZE } from './inference';
import { ensureDefaultModel } from './model-manager';
import type { DetectionResult, DetectShotsOptions, ShotBoundary, ShotDetectorOptions, ShotSegment } from './types';

export const WINDOW_STEP = WINDOW_SIZE - 10;
export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_MIN_SHOT_DURATION_MS = 500;

export class ShotDetector {
  private readonly threshold: number;
  private readonly minShotDurationMs: number;
  private readonly modelPromise: Promise<TransNetV2ONNX>;

  constructor(options: ShotDetectorOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
    this.minShotDurationMs = options.minShotDurationMs ?? DEFAULT_MIN_SHOT_DURATION_MS;
    this.modelPromise = this.createModel(options);
  }

  private async createModel(options: ShotDetectorOptions): Promise<TransNetV2ONNX> {
    const modelPath = await ensureDefaultModel({
      ...(options.modelPath !== undefined ? { modelPath: options.modelPath } : {}),
      ...(options.modelCacheDir !== undefined ? { cacheDir: options.modelCacheDir } : {}),
      ...(options.modelUrl !== undefined ? { modelUrl: options.modelUrl } : {}),
    });
    const model = new TransNetV2ONNX(modelPath);
    await model.initialize();
    return model;
  }

  async detect(videoPath: string): Promise<ShotSegment[]> {
    return (await this.detectDetailed(videoPath)).shots;
  }

  async detectDetailed(videoPath: string): Promise<DetectionResult> {
    const [metadata, rawFrames, model] = await Promise.all([
      probeVideo(videoPath),
      extractLowResRgbFrames(videoPath),
      this.modelPromise,
    ]);

    const frameSize = MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT * MODEL_INPUT_CHANNELS;
    const totalFrames = Math.floor(rawFrames.length / frameSize);
    if (totalFrames <= 0) {
      throw new ShotDetectionError('No frames were extracted from the input video');
    }

    const truncatedFrames = new Uint8Array(rawFrames.buffer, rawFrames.byteOffset, totalFrames * frameSize);
    const allProbabilities: number[] = [];

    for (let start = 0; start < totalFrames; start += WINDOW_STEP) {
      const end = Math.min(start + WINDOW_SIZE, totalFrames);
      const windowFrames = end - start;
      if (windowFrames < 10) break;

      const buffer = new Uint8Array(MODEL_INPUT_SIZE);
      buffer.set(truncatedFrames.subarray(start * frameSize, end * frameSize), 0);

      const probabilities = await model.infer(buffer);
      for (let offset = 0; offset < windowFrames; offset += 1) {
        const frameIndex = start + offset;
        if (frameIndex >= allProbabilities.length) {
          allProbabilities.push(toBoundaryProbability(probabilities[offset] ?? 0));
        }
      }
    }

    const peakIndices = findPeaks(allProbabilities, this.threshold);
    const boundaries: ShotBoundary[] = peakIndices.map((frameIndex) => ({
      frameIndex,
      timestampMs: Math.round((frameIndex / metadata.fps) * 1000),
      confidence: allProbabilities[frameIndex] ?? 0,
    }));

    const shots = boundariesToShots(boundaries, metadata.durationMs, this.minShotDurationMs);

    return {
      boundaries,
      shots,
      totalFrames,
      fps: metadata.fps,
      durationMs: metadata.durationMs,
    };
  }

  async close(): Promise<void> {
    const model = await this.modelPromise;
    await model.close();
  }
}

export async function detectShots(options: DetectShotsOptions): Promise<ShotSegment[]> {
  const detector = new ShotDetector(options);
  try {
    return await detector.detect(options.videoPath);
  } finally {
    await detector.close();
  }
}

export async function detectShotsDetailed(options: DetectShotsOptions): Promise<DetectionResult> {
  const detector = new ShotDetector(options);
  try {
    return await detector.detectDetailed(options.videoPath);
  } finally {
    await detector.close();
  }
}

export function toBoundaryProbability(value: number): number {
  if (value >= 0 && value <= 1) return value;
  return 1 / (1 + Math.exp(-value));
}

export function findPeaks(probs: readonly number[], threshold: number, minDistance = 10): number[] {
  const peaks: number[] = [];

  for (let index = 1; index < probs.length - 1; index += 1) {
    const current = probs[index] ?? 0;
    const previous = probs[index - 1] ?? 0;
    const following = probs[index + 1] ?? 0;

    if (current > threshold && current > previous && current > following) {
      if (peaks.length === 0 || index - peaks[peaks.length - 1]! >= minDistance) {
        peaks.push(index);
      } else if (current > (probs[peaks[peaks.length - 1]!] ?? 0)) {
        peaks[peaks.length - 1] = index;
      }
    }
  }

  return peaks;
}

export function boundariesToShots(
  boundaries: readonly ShotBoundary[],
  durationMs: number,
  minShotDurationMs = DEFAULT_MIN_SHOT_DURATION_MS,
): ShotSegment[] {
  const startPoints = [0, ...boundaries.map((boundary) => boundary.timestampMs)];
  const endPoints = [...boundaries.map((boundary) => boundary.timestampMs), durationMs];

  const shots = startPoints.map((startMs, index) => ({
    index,
    startMs,
    endMs: endPoints[index] ?? durationMs,
  }));

  return mergeShortShots(shots, minShotDurationMs);
}

export function mergeShortShots(shots: readonly ShotSegment[], minShotDurationMs: number): ShotSegment[] {
  if (shots.length <= 1) return [...shots];

  let merged = shots.map((shot) => ({ index: shot.index, startMs: shot.startMs, endMs: shot.endMs }));
  let hasShort = true;

  while (hasShort) {
    hasShort = false;
    const nextShots: Array<{ index: number; startMs: number; endMs: number }> = [];

    for (let index = 0; index < merged.length; index += 1) {
      const shot = merged[index]!;
      const duration = shot.endMs - shot.startMs;
      if (duration >= minShotDurationMs) {
        nextShots.push(shot);
        continue;
      }

      hasShort = true;
      const previous = nextShots[nextShots.length - 1];
      const following = merged[index + 1];

      if (!previous && following) {
        following.startMs = shot.startMs;
      } else if (previous && !following) {
        previous.endMs = shot.endMs;
      } else if (previous && following) {
        const previousDuration = previous.endMs - previous.startMs;
        const followingDuration = following.endMs - following.startMs;
        if (previousDuration <= followingDuration) {
          previous.endMs = shot.endMs;
        } else {
          following.startMs = shot.startMs;
        }
      }
    }

    merged = nextShots;
    if (merged.length <= 1) break;
  }

  return merged.map((shot, index) => ({
    index,
    startMs: shot.startMs,
    endMs: shot.endMs,
  }));
}
