import type * as ortTypes from 'onnxruntime-node';

import { ShotDetectionError } from './errors';

export const WINDOW_SIZE = 100;
export const MODEL_INPUT_WIDTH = 48;
export const MODEL_INPUT_HEIGHT = 27;
export const MODEL_INPUT_CHANNELS = 3;
export const MODEL_INPUT_SIZE = WINDOW_SIZE * MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT * MODEL_INPUT_CHANNELS;
const DEFAULT_LOG_SEVERITY_LEVEL = 3;

type OnnxRuntimeModule = typeof import('onnxruntime-node');
type SessionOptions = ortTypes.InferenceSession.SessionOptions;

interface SessionPlan {
  label: string;
  modelPath: string;
  sessionOptions: SessionOptions;
}

export class TransNetV2ONNX {
  private ort: OnnxRuntimeModule | null = null;
  private session: ortTypes.InferenceSession | null = null;
  private inputName: string | null = null;
  private outputName: string | null = null;
  private inputTensorType: 'uint8' | 'float32' = 'uint8';

  constructor(private readonly modelPath: string) {}

  private async loadOrt(): Promise<OnnxRuntimeModule> {
    if (this.ort) return this.ort;

    try {
      this.ort = await import('onnxruntime-node');
      return this.ort;
    } catch (error) {
      throw new ShotDetectionError(`Failed to load onnxruntime-node: ${String(error)}`);
    }
  }

  private createSessionOptions(executionProviders: string[]): SessionOptions {
    return {
      executionProviders,
      graphOptimizationLevel: 'all',
      executionMode: 'sequential',
      enableCpuMemArena: true,
      enableMemPattern: true,
      logSeverityLevel: DEFAULT_LOG_SEVERITY_LEVEL,
    };
  }

  private buildSessionPlans(availableBackends: string[]): SessionPlan[] {
    const plans: SessionPlan[] = [];
    const backendSet = new Set(availableBackends);

    if (process.platform === 'darwin' && backendSet.has('coreml')) {
      plans.push({
        label: 'coreml',
        modelPath: this.modelPath,
        sessionOptions: this.createSessionOptions(['coreml', 'cpu']),
      });
    }

    if (process.platform === 'win32' && backendSet.has('dml')) {
      plans.push({
        label: 'directml',
        modelPath: this.modelPath,
        sessionOptions: this.createSessionOptions(['dml', 'cpu']),
      });
    }

    plans.push({
      label: 'cpu',
      modelPath: this.modelPath,
      sessionOptions: this.createSessionOptions(['cpu']),
    });

    return plans;
  }

  private resolveInputTensorType(session: ortTypes.InferenceSession, inputName: string): 'uint8' | 'float32' {
    const inputMetadata = (session as unknown as {
      inputMetadata?: Array<{ name?: string; type?: string }>;
    }).inputMetadata?.find((metadata) => metadata.name === inputName);

    if (inputMetadata?.type === 'uint8' || inputMetadata?.type === 'tensor(uint8)') {
      return 'uint8';
    }

    return 'float32';
  }

  async initialize(): Promise<void> {
    if (this.session) return;

    const ort = await this.loadOrt();
    const availableBackends =
      typeof ort.listSupportedBackends === 'function' ? ort.listSupportedBackends().map((backend) => backend.name) : [];
    const plans = this.buildSessionPlans(availableBackends);
    const errors: string[] = [];

    for (const plan of plans) {
      try {
        this.session = await ort.InferenceSession.create(plan.modelPath, plan.sessionOptions);
        this.inputName = this.session.inputNames[0] ?? null;
        this.outputName = this.session.outputNames[0] ?? null;

        if (!this.inputName || !this.outputName) {
          throw new ShotDetectionError('Model missing input or output names');
        }

        this.inputTensorType = this.resolveInputTensorType(this.session, this.inputName);
        await this.warmup();
        return;
      } catch (error) {
        errors.push(`${plan.label}: ${String(error)}`);
        if (this.session && typeof this.session.release === 'function') {
          await this.session.release();
          this.session = null;
        }
      }
    }

    throw new ShotDetectionError(`Failed to initialize ONNX Runtime session. Attempts: ${errors.join(' | ')}`);
  }

  private async warmup(): Promise<void> {
    if (!this.session || !this.ort || !this.inputName) return;

    const warmupFrames = new Uint8Array(MODEL_INPUT_SIZE);
    const tensor =
      this.inputTensorType === 'uint8'
        ? new this.ort.Tensor('uint8', warmupFrames, [
            1,
            WINDOW_SIZE,
            MODEL_INPUT_HEIGHT,
            MODEL_INPUT_WIDTH,
            MODEL_INPUT_CHANNELS,
          ])
        : new this.ort.Tensor(
            'float32',
            new Float32Array(warmupFrames.length),
            [1, WINDOW_SIZE, MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH, MODEL_INPUT_CHANNELS],
          );

    await this.session.run({ [this.inputName]: tensor });
  }

  async infer(frames: Uint8Array): Promise<Float32Array> {
    await this.initialize();

    if (!this.session || !this.ort || !this.inputName || !this.outputName) {
      throw new ShotDetectionError('ONNX Runtime session is not initialized');
    }

    if (frames.length !== MODEL_INPUT_SIZE) {
      throw new ShotDetectionError(`Invalid input size: expected ${MODEL_INPUT_SIZE}, got ${frames.length}`);
    }

    const inputTensor =
      this.inputTensorType === 'uint8'
        ? new this.ort.Tensor('uint8', frames, [1, WINDOW_SIZE, MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH, MODEL_INPUT_CHANNELS])
        : new this.ort.Tensor(
            'float32',
            Float32Array.from(frames),
            [1, WINDOW_SIZE, MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH, MODEL_INPUT_CHANNELS],
          );

    let results: Awaited<ReturnType<ortTypes.InferenceSession['run']>>;
    try {
      results = await this.session.run({ [this.inputName]: inputTensor });
    } catch (error) {
      throw new ShotDetectionError(`ONNX inference failed: ${String(error)}`);
    }

    const output = results[this.outputName];
    if (!output) {
      throw new ShotDetectionError('Model output is missing');
    }

    const data = output.data;
    if (data instanceof Float32Array) {
      if (data.length < WINDOW_SIZE) {
        throw new ShotDetectionError(`Model output is too short: ${data.length}`);
      }
      return data.slice(0, WINDOW_SIZE);
    }

    const floatData = Float32Array.from(Array.from(data as ArrayLike<number>, (value) => Number(value)));
    if (floatData.length < WINDOW_SIZE) {
      throw new ShotDetectionError(`Model output is too short: ${floatData.length}`);
    }
    return floatData.slice(0, WINDOW_SIZE);
  }

  async close(): Promise<void> {
    if (this.session && typeof this.session.release === 'function') {
      await this.session.release();
    }
    this.session = null;
    this.inputName = null;
    this.outputName = null;
    this.inputTensorType = 'uint8';
  }
}
