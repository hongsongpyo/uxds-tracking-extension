import {
  describe,
  expect,
  it
} from "vitest";

import {
  RuntimeGazeDriftMonitor
} from "../../../src/gaze/runtimeGazeDriftMonitor";

const VIEWPORT = {
  width: 1_000,
  height: 800
};

const NO_POSE_DRIFT = {
  deltaHeadYawDeg: 0,
  deltaHeadPitchDeg: 0,
  deltaHeadRollDeg: 0,
  deltaFaceCenterX: 0,
  deltaFaceCenterY: 0,
  faceWidthScaleDelta: 0,
  faceHeightScaleDelta: 0,
  faceDistanceDelta: 0
};

describe("RuntimeGazeDriftMonitor", () => {
  it("learns an early precision reference and recommends maintenance after sustained precision deterioration", () => {
    const monitor = new RuntimeGazeDriftMonitor();

    let status = monitor.update(
      0,
      NO_POSE_DRIFT,
      VIEWPORT,
      10,
      0.9
    );

    for (let second = 1; second <= 16; second += 1) {
      status = monitor.update(
        second * 1_000,
        NO_POSE_DRIFT,
        VIEWPORT,
        10,
        0.9
      );
    }

    expect(status?.precisionReferencePx).toBeCloseTo(10, 6);
    expect(status?.quickRecalibrationRecommended).toBe(false);

    /* Automatic maintenance has a one-minute no-interruption grace period. */
    monitor.update(
      60_000,
      NO_POSE_DRIFT,
      VIEWPORT,
      10,
      0.9
    );

    for (let step = 0; step <= 10; step += 1) {
      status = monitor.update(
        61_000 + step * 500,
        NO_POSE_DRIFT,
        VIEWPORT,
        30,
        0.9
      );
    }

    expect(status?.precisionRatio).toBeCloseTo(3, 6);
    expect(status?.maintenanceReason).toBe("PRECISION");
    expect(status?.quickRecalibrationRecommended).toBe(true);
  });

  it("requests periodic multi-point maintenance after twenty minutes even without pose drift", () => {
    const monitor = new RuntimeGazeDriftMonitor();

    monitor.update(
      0,
      NO_POSE_DRIFT,
      VIEWPORT,
      null,
      0.9
    );

    const status = monitor.update(
      20 * 60_000,
      NO_POSE_DRIFT,
      VIEWPORT,
      null,
      0.9
    );

    expect(status?.periodicMaintenanceDue).toBe(true);
    expect(status?.maintenanceReason).toBe("PERIODIC");
    expect(status?.quickRecalibrationRecommended).toBe(true);
  });

  it("does not treat a short precision spike as persistent deterioration", () => {
    const monitor = new RuntimeGazeDriftMonitor();

    for (let second = 0; second <= 16; second += 1) {
      monitor.update(
        second * 1_000,
        NO_POSE_DRIFT,
        VIEWPORT,
        10,
        0.9
      );
    }

    monitor.update(
      17_000,
      NO_POSE_DRIFT,
      VIEWPORT,
      35,
      0.9
    );

    const recovered = monitor.update(
      17_500,
      NO_POSE_DRIFT,
      VIEWPORT,
      11,
      0.9
    );

    expect(recovered?.quickRecalibrationRecommended).toBe(false);
    expect(recovered?.maintenanceReason).toBeNull();
  });
  it("does not auto-trigger maintenance when gaze quality is too low", () => {
    const monitor = new RuntimeGazeDriftMonitor();

    for (let second = 0; second <= 16; second += 1) {
      monitor.update(
        second * 1_000,
        NO_POSE_DRIFT,
        VIEWPORT,
        10,
        0.9
      );
    }

    let status = monitor.update(
      61_000,
      NO_POSE_DRIFT,
      VIEWPORT,
      40,
      0.4
    );

    for (let step = 1; step <= 12; step += 1) {
      status = monitor.update(
        61_000 + step * 500,
        NO_POSE_DRIFT,
        VIEWPORT,
        40,
        0.4
      );
    }

    expect(status?.quickRecalibrationRecommended).toBe(false);
    expect(status?.maintenanceReason).toBeNull();
  });

});

describe("continuous evidence and session reference", () => {
  it("does not count an unobserved camera gap as sustained posture drift", () => {
    const monitor = new RuntimeGazeDriftMonitor();
    const highPose = { ...NO_POSE_DRIFT, deltaHeadYawDeg: 25 };
    monitor.update(0, NO_POSE_DRIFT, VIEWPORT, 10, 0.9);
    monitor.update(61_000, highPose, VIEWPORT, 10, 0.9);
    const resumed = monitor.update(90_000, highPose, VIEWPORT, 10, 0.9);
    expect(resumed?.quickRecalibrationRecommended).toBe(false);
  });

  it("preserves the learned reference and periodic clock through temporary face loss", () => {
    const monitor = new RuntimeGazeDriftMonitor();
    for (let i = 0; i <= 16; i += 1) {
      monitor.update(i * 1_000, NO_POSE_DRIFT, VIEWPORT, 10, 0.9);
    }
    monitor.update(17_000, null, VIEWPORT, null, 0);
    const resumed = monitor.update(18_000, NO_POSE_DRIFT, VIEWPORT, 20, 0.9);
    expect(resumed?.precisionReferencePx).toBeCloseTo(10);
    expect(resumed?.monitoringElapsedMs).toBe(18_000);
  });

  it("does not compare CSS pixels from different viewport widths", () => {
    const monitor = new RuntimeGazeDriftMonitor();
    for (let i = 0; i <= 16; i += 1) {
      monitor.update(i * 1_000, NO_POSE_DRIFT, VIEWPORT, 10, 0.9);
    }
    const resized = monitor.update(17_000, NO_POSE_DRIFT,
      { width: 2_000, height: 1_600 }, 20, 0.9);
    expect(resized?.precisionRatio).toBeCloseTo(1);
    expect(resized?.precisionReferencePx).toBeCloseTo(20);
  });

  it("requires fresh quality evidence after a low-quality interval", () => {
    const monitor = new RuntimeGazeDriftMonitor();
    const highPose = { ...NO_POSE_DRIFT, deltaHeadYawDeg: 25 };
    monitor.update(0, NO_POSE_DRIFT, VIEWPORT, 10, 0.9);
    for (let i = 0; i <= 10; i += 1) {
      monitor.update(61_000 + i * 500, highPose, VIEWPORT, 40, 0.2);
    }
    const recovered = monitor.update(66_500, highPose, VIEWPORT, 10, 0.9);
    expect(recovered?.quickRecalibrationRecommended).toBe(false);
  });
});

describe("session-wide reference across page boundaries", () => {
  it("keeps maintenance due at twenty minutes despite navigation every thirty seconds", () => {
    const monitor = new RuntimeGazeDriftMonitor();
    let status = null;
    for (let second = 0; second <= 1200; second += 1) {
      if (second > 0 && second % 30 === 0) monitor.interrupt();
      status = monitor.update(second * 1000, NO_POSE_DRIFT, VIEWPORT, 10, 0.9);
    }
    expect(status?.precisionReferencePx).toBeCloseTo(10);
    expect(status?.monitoringElapsedMs).toBe(1_200_000);
    expect(status?.maintenanceReason).toBe("PERIODIC");
  });

  it("does not interpret NaN pose as zero drift or keep old continuous evidence", () => {
    const monitor = new RuntimeGazeDriftMonitor();
    const highPose = { ...NO_POSE_DRIFT, deltaHeadYawDeg: 25 };
    monitor.update(0, NO_POSE_DRIFT, VIEWPORT, 10, 0.9);
    for (let t = 61_000; t <= 65_000; t += 500) {
      monitor.update(t, highPose, VIEWPORT, 10, 0.9);
    }
    expect(monitor.update(65_500, { ...highPose, deltaFaceCenterX: Number.NaN }, VIEWPORT, 10, 0.9)).toBeNull();
    expect(monitor.update(66_000, highPose, VIEWPORT, 10, 0.9)?.quickRecalibrationRecommended).toBe(false);
  });
});
