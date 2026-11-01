export interface WebEyeTrackGazeResult {
  readonly gazeState: "open" | "closed";
  readonly normPog: readonly number[];
  readonly timestamp: number;
}

export class WebEyeTrack {
  public loaded: boolean;
  public latestGazeResult: WebEyeTrackGazeResult | null;

  public constructor(
    maxPoints?: number,
    clickTTL?: number
  );

  public step(
    frame: ImageData,
    timestamp: number
  ): Promise<WebEyeTrackGazeResult>;
}

export const __WEBEYETRACK_VENDOR_STUB__:
  boolean | undefined;
