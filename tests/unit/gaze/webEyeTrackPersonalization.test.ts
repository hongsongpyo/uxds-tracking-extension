import {
  describe,
  expect,
  it
} from "vitest";

import {
  WebEyeTrackEngine
} from "../../../src/gaze/webEyeTrackEngine";

import type {
  WebEyeTrackBackend
} from "../../../src/gaze/webEyeTrackEngine";

class PersonalizationBackend
implements WebEyeTrackBackend {
  public beginCount = 0;
  public recordedPointIndex: number | null = null;
  public stagedPointIndex: number | null = null;

  public initialize(): Promise<void> {
    return Promise.resolve();
  }

  public predict() {
    return Promise.resolve(null);
  }

  public beginPersonalizationSession(): void {
    this.beginCount += 1;
  }

  public recordLatestPersonalizationCandidate(
    pointIndex: number
  ): boolean {
    this.recordedPointIndex = pointIndex;
    return true;
  }

  public stagePersonalizationPoint(
    pointIndex: number
  ): boolean {
    this.stagedPointIndex = pointIndex;
    return true;
  }

  public applyPersonalization() {
    return Promise.resolve({
      applied: true,
      stagedPointCount: 17,
      supportPointCount: 9
    });
  }

  public dispose(): Promise<void> {
    return Promise.resolve();
  }
}

describe("WebEyeTrackEngine personalization boundary", () => {
  it("forwards project-owned calibration events to a native personalization backend", async () => {
    const backend =
      new PersonalizationBackend();

    const engine =
      new WebEyeTrackEngine(backend);

    await engine.initialize();

    expect(engine.supportsPersonalization())
      .toBe(true);
    expect(engine.beginPersonalizationSession())
      .toBe(true);
    expect(
      engine.recordLatestPersonalizationCandidate(
        3,
        1_500
      )
    ).toBe(true);
    expect(
      engine.stagePersonalizationPoint(
        3,
        { x: 0.25, y: 0.75 },
        1_450,
        1_900
      )
    ).toBe(true);

    const result =
      await engine.applyPersonalization();

    expect(backend.beginCount).toBe(1);
    expect(backend.recordedPointIndex).toBe(3);
    expect(backend.stagedPointIndex).toBe(3);
    expect(result).toEqual({
      applied: true,
      stagedPointCount: 17,
      supportPointCount: 9
    });
  });
});
