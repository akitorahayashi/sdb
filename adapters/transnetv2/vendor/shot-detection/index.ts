export { ShotDetector, detectShots, detectShotsDetailed } from './detector';
export { ShotDetectionError } from './errors';
export {
  DEFAULT_MODEL_URL,
  ensureDefaultModel,
  getDefaultCacheDir,
  getDefaultModelPath,
} from './model-manager';
export type {
  DetectionResult,
  DetectShotsOptions,
  ShotBoundary,
  ShotDetectorOptions,
  ShotSegment,
  VideoMetadata,
} from './types';
