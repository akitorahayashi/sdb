import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { ShotDetectionError } from './errors';
import type { VideoMetadata } from './types';

export const MODEL_INPUT_WIDTH = 48;
export const MODEL_INPUT_HEIGHT = 27;

export interface FfmpegRuntimeCapabilities {
  hwaccels: Set<string>;
  decoders: Set<string>;
}

export interface FfmpegInputPlan {
  label: string;
  inputOptions: string[];
  usesHardwareDecode: boolean;
}

export function resolveBinary(name: string): string {
  const pathValue = process.env['PATH'] ?? '';
  for (const directory of pathValue.split(process.platform === 'win32' ? ';' : ':')) {
    if (!directory) continue;
    const candidate = process.platform === 'win32' ? `${directory}\\${name}.exe` : `${directory}/${name}`;
    const fallback = `${directory}/${name}`;
    if (existsSync(candidate)) return candidate;
    if (existsSync(fallback)) return fallback;
  }

  throw new ShotDetectionError(
    `Required binary '${name}' was not found on PATH. Please install FFmpeg before running shot detection.`,
  );
}

export async function runCommand(command: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on('error', (error) => {
      reject(new ShotDetectionError(String(error)));
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new ShotDetectionError(stderr || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

export function parseFFmpegList(output: string): Set<string> {
  const values = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^[A-Z.]{1,7}\s+([a-z0-9_]+)/i);
    if (match?.[1]) {
      values.add(match[1].toLowerCase());
      continue;
    }

    if (/^[a-z0-9_]+$/i.test(trimmed)) {
      values.add(trimmed.toLowerCase());
    }
  }
  return values;
}

export async function getRuntimeCapabilities(ffmpegPath: string): Promise<FfmpegRuntimeCapabilities> {
  const [hwaccelsResult, decodersResult] = await Promise.all([
    runCommand(ffmpegPath, ['-hide_banner', '-hwaccels']),
    runCommand(ffmpegPath, ['-hide_banner', '-decoders']),
  ]);

  return {
    hwaccels: parseFFmpegList(hwaccelsResult.stdout.toString('utf8')),
    decoders: parseFFmpegList(decodersResult.stdout.toString('utf8')),
  };
}

function resolveLinuxVaapiDevice(): string | null {
  const candidates = ['/dev/dri/renderD128', '/dev/dri/renderD129'];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function getDecodePlansFromCapabilities(
  capabilities: FfmpegRuntimeCapabilities,
  platformName = process.platform,
): FfmpegInputPlan[] {
  const plans: FfmpegInputPlan[] = [];

  if (platformName === 'darwin' && capabilities.hwaccels.has('videotoolbox')) {
    plans.push({
      label: 'videotoolbox-hardware',
      inputOptions: ['-threads', '1', '-hwaccel', 'videotoolbox'],
      usesHardwareDecode: true,
    });
  }

  if (platformName === 'win32') {
    if (capabilities.hwaccels.has('d3d12va')) {
      plans.push({
        label: 'd3d12va-hardware',
        inputOptions: ['-threads', '1', '-hwaccel', 'd3d12va', '-hwaccel_output_format', 'd3d12'],
        usesHardwareDecode: true,
      });
    }
    if (capabilities.hwaccels.has('d3d11va')) {
      plans.push({
        label: 'd3d11va-hardware',
        inputOptions: ['-threads', '1', '-hwaccel', 'd3d11va', '-hwaccel_output_format', 'd3d11'],
        usesHardwareDecode: true,
      });
    }
    if (capabilities.hwaccels.has('dxva2')) {
      plans.push({
        label: 'dxva2-hardware',
        inputOptions: ['-threads', '1', '-hwaccel', 'dxva2', '-hwaccel_output_format', 'dxva2_vld'],
        usesHardwareDecode: true,
      });
    }
  }

  if (platformName === 'linux' && capabilities.hwaccels.has('vaapi')) {
    const vaapiDevice = resolveLinuxVaapiDevice();
    if (vaapiDevice) {
      plans.push({
        label: 'vaapi-hardware',
        inputOptions: [
          '-threads',
          '1',
          '-hwaccel',
          'vaapi',
          '-hwaccel_output_format',
          'vaapi',
          '-vaapi_device',
          vaapiDevice,
        ],
        usesHardwareDecode: true,
      });
    }
  }

  plans.push({
    label: 'software-fallback',
    inputOptions: ['-threads', '1'],
    usesHardwareDecode: false,
  });

  return plans;
}

export async function getDecodePlans(platformName = process.platform): Promise<FfmpegInputPlan[]> {
  const ffmpegPath = resolveBinary('ffmpeg');
  const capabilities = await getRuntimeCapabilities(ffmpegPath);
  return getDecodePlansFromCapabilities(capabilities, platformName);
}

export function requiresHwdownload(plan: FfmpegInputPlan, platformName = process.platform): boolean {
  if (platformName === 'darwin' && plan.label === 'videotoolbox-hardware') {
    return false;
  }
  return plan.usesHardwareDecode;
}

function parseFrameRate(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  if (value.includes('/')) {
    const [numeratorText, denominatorText] = value.split('/', 2);
    const numerator = Number(numeratorText);
    const denominator = Number(denominatorText);
    return denominator === 0 ? 0 : numerator / denominator;
  }
  return Number(value);
}

function parseDurationSeconds(formatInfo: unknown, videoStream: Record<string, unknown>): number {
  if (typeof formatInfo === 'object' && formatInfo !== null) {
    const formatDuration = Number((formatInfo as Record<string, unknown>)['duration'] ?? 0);
    if (formatDuration > 0) return formatDuration;
  }
  return Number(videoStream['duration'] ?? 0);
}

export async function probeVideo(videoPath: string): Promise<VideoMetadata> {
  const ffprobePath = resolveBinary('ffprobe');
  const result = await runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-print_format',
    'json',
    videoPath,
  ]);

  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    throw new ShotDetectionError('Failed to parse ffprobe output');
  }

  const streams = typeof payload === 'object' && payload !== null && Array.isArray((payload as Record<string, unknown>)['streams'])
    ? ((payload as Record<string, unknown>)['streams'] as unknown[])
    : null;
  if (!streams) {
    throw new ShotDetectionError('ffprobe did not return stream metadata');
  }

  const videoStream = streams.find(
    (stream) => typeof stream === 'object' && stream !== null && (stream as Record<string, unknown>)['codec_type'] === 'video',
  ) as Record<string, unknown> | undefined;
  if (!videoStream) {
    throw new ShotDetectionError('No video stream found in the input file');
  }

  const width = Number(videoStream['width'] ?? 0);
  const height = Number(videoStream['height'] ?? 0);
  const fps = parseFrameRate(videoStream['avg_frame_rate'] ?? videoStream['r_frame_rate']);
  const durationSeconds = parseDurationSeconds(
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)['format'] : undefined,
    videoStream,
  );

  if (!(width > 0) || !(height > 0) || !(fps > 0) || !(durationSeconds > 0)) {
    throw new ShotDetectionError('Unable to determine valid video metadata');
  }

  return {
    durationMs: Math.round(durationSeconds * 1000),
    width,
    height,
    fps,
    ...(typeof videoStream['codec_name'] === 'string' ? { codec: videoStream['codec_name'] } : {}),
  };
}

export async function extractLowResRgbFrames(
  videoPath: string,
  options: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const ffmpegPath = resolveBinary('ffmpeg');
  const plans = await getDecodePlans();
  let lastError: unknown;
  const width = options.width ?? MODEL_INPUT_WIDTH;
  const height = options.height ?? MODEL_INPUT_HEIGHT;

  for (const plan of plans) {
    const scaleFilter = `scale=${width}:${height}:flags=fast_bilinear`;
    const filterChain = requiresHwdownload(plan)
      ? `hwdownload,format=nv12,${scaleFilter},format=rgb24`
      : `${scaleFilter},format=rgb24`;

    try {
      const result = await runCommand(ffmpegPath, [
        '-v',
        'error',
        ...plan.inputOptions,
        '-i',
        videoPath,
        '-vf',
        filterChain,
        '-pix_fmt',
        'rgb24',
        '-vsync',
        '0',
        '-f',
        'rawvideo',
        'pipe:1',
      ]);

      return result.stdout;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ShotDetectionError('No FFmpeg decode plan was available');
}
