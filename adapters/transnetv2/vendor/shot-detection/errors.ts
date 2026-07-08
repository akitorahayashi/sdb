export class ShotDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShotDetectionError';
  }
}
