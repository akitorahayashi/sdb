import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { get } from 'node:https';
import { get as getHttp } from 'node:http';

import { ShotDetectionError } from './errors';

export const DEFAULT_MODEL_URL = 'https://download.shotai.io/model/shot-detection/transnetv2_open_fp16.onnx';
export const DEFAULT_MODEL_FILENAME = 'transnetv2_open_fp16.onnx';
export const DEFAULT_CACHE_DIRNAME = 'seeknetic-shot-detection';

function getDownloader(url: string) {
  return url.startsWith('https:') ? get : getHttp;
}

export function getDefaultCacheDir(): string {
  const override = process.env['SEEKNETIC_SHOT_DETECTION_CACHE_DIR'];
  if (override) return override;

  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) return join(localAppData, DEFAULT_CACHE_DIRNAME);
  }

  const xdgCacheHome = process.env['XDG_CACHE_HOME'];
  if (xdgCacheHome) return join(xdgCacheHome, DEFAULT_CACHE_DIRNAME);

  return join(homedir(), '.cache', DEFAULT_CACHE_DIRNAME);
}

export function getDefaultModelPath(cacheDir?: string): string {
  return join(cacheDir ?? getDefaultCacheDir(), 'models', DEFAULT_MODEL_FILENAME);
}

async function downloadFile(url: string, outputPath: string, timeoutMs: number, redirectsLeft = 5): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = getDownloader(url)(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new ShotDetectionError(`Too many redirects while downloading model from ${url}`));
          return;
        }
        const redirectedUrl = new URL(location, url).toString();
        downloadFile(redirectedUrl, outputPath, timeoutMs, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new ShotDetectionError(`Failed to download model: HTTP ${statusCode} from ${url}`));
        return;
      }

      const file = createWriteStream(outputPath);
      response.on('error', reject);
      file.on('error', reject);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      response.pipe(file);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new ShotDetectionError(`Timed out downloading model from ${url}`));
    });
    request.on('error', reject);
  });
}

export async function ensureDefaultModel(options: {
  modelPath?: string;
  cacheDir?: string;
  modelUrl?: string;
  timeoutMs?: number;
} = {}): Promise<string> {
  const resolvedPath = options.modelPath ?? getDefaultModelPath(options.cacheDir);
  if (existsSync(resolvedPath)) return resolvedPath;

  mkdirSync(dirname(resolvedPath), { recursive: true });

  const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await downloadFile(options.modelUrl ?? DEFAULT_MODEL_URL, tempPath, options.timeoutMs ?? 60_000);
    const size = statSync(tempPath).size;
    if (size <= 0) {
      throw new ShotDetectionError(`Downloaded model is empty: ${options.modelUrl ?? DEFAULT_MODEL_URL}`);
    }
    renameSync(tempPath, resolvedPath);
    return resolvedPath;
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore best-effort temp cleanup failures.
    }
    throw new ShotDetectionError(
      `Failed to download the default shot detection model from ${options.modelUrl ?? DEFAULT_MODEL_URL}: ${String(error)}`,
    );
  }
}
