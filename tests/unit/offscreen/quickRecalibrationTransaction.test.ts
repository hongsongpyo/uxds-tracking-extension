import { afterEach, describe, expect, it, vi } from "vitest";
import { CalibrationManager } from "../../../src/calibration/calibrationManager";
import { createCalibrationPattern, createQuickValidationPattern } from "../../../src/calibration/calibrationPattern";
import type { CalibrationObservation } from "../../../src/calibration/calibrationCollector";
import { CalibrationHybridSelector } from "../../../src/gaze/calibrationHybridSelector";
import { DeepPersonalMapper } from "../../../src/gaze/deepPersonalMapper";
import { ResidualCorrector } from "../../../src/gaze/residualCorrector";
import { ValidationManager } from "../../../src/calibration/validationManager";
import { DeepIndependentValidator } from "../../../src/gaze/deepIndependentValidator";
import { TrackerRuntime } from "../../../src/offscreen/trackerRuntime";
import type { CalibrationTarget, Point2D } from "../../../src/shared/types";

const VIEWPORT = { width: 1000, height: 800 };
const HEAD = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

// Reflect.get returns `any` in the JS standard library. Keep reflective access
// untrusted in this white-box test rather than allowing `any` to propagate.
function runtimeField(runtime: TrackerRuntime, property: string): unknown {
  return Reflect.get(runtime, property) as unknown;
}

function finishActiveValidationPoint(runtime: TrackerRuntime): void {
  const method = runtimeField(runtime, "finishActiveValidationPoint");
  if (typeof method !== "function") {
    throw new Error("Missing private finishActiveValidationPoint test hook.");
  }
  const invoke = method as (this: TrackerRuntime) => void;
  invoke.call(runtime);
}

function observation(timestampMs: number, point: Point2D): CalibrationObservation {
  return {
    prediction: {
      timestampMs, rawPoint: point, rawSpace: "NORMALIZED", confidence: 0.92,
      faceValid: true, eyesValid: true, headPose: HEAD, source: "WEB_EYE_TRACK"
    },
    gazeValid: true, gazeQuality: 0.9,
    face: {
      faceValid: true, eyesValid: true,
      leftEyeVisible: true, rightEyeVisible: true, blink: false,
      faceConfidence: 0.95, eyeConfidence: 0.95, faceDistanceRatio: 1,
      headPose: HEAD, qualityScore: 0.9, qualityLevel: "GOOD"
    }
  };
}

function collectStableSamples(
  manager: CalibrationManager | ValidationManager,
  target: CalibrationTarget,
  gaze: Point2D,
  targetShownAtMs: number
): void {
  manager.beginPoint("quick_test", target, targetShownAtMs);
  for (let index = 0; index < 12; index += 1) {
    manager.observe(observation(
      targetShownAtMs + 500 + index * 30,
      { x: gaze.x + (index % 2 === 0 ? 0.001 : -0.001),
        y: gaze.y + (index % 3 === 0 ? 0.001 : -0.001) }
    ));
  }
}

function fittedCalibration(): CalibrationManager {
  const manager = new CalibrationManager();
  manager.start("quick_test", "STANDARD_17");
  for (const target of createCalibrationPattern("STANDARD_17", VIEWPORT)) {
    const t = 1000 + target.pointIndex * 2000;
    collectStableSamples(manager, target, target.normalizedPoint, t);
    expect(manager.finishActivePoint(t + 1300).sufficient).toBe(true);
  }
  expect(manager.getSnapshot().modelReady).toBe(true);
  return manager;
}

function createRuntime(manager: CalibrationManager): TrackerRuntime {
  // The runtime is constructed but no camera or browser APIs are initialized.
  const runtime = new TrackerRuntime({} as HTMLVideoElement);
  const mapper = new DeepPersonalMapper();
  mapper.start("quick_test", 17);
  const corrector = new ResidualCorrector();
  const model = manager.getModel();
  if (model === null) throw new Error("Test calibration is not fitted.");
  corrector.setModel(model);
  Reflect.set(runtime, "calibrationManager", manager);
  Reflect.set(runtime, "deepPersonalMapper", mapper);
  Reflect.set(runtime, "calibrationHybridSelector", new CalibrationHybridSelector());
  Reflect.set(runtime, "residualCorrector", corrector);
  Reflect.set(runtime, "validationManager", new ValidationManager());
  Reflect.set(runtime, "deepIndependentValidator", new DeepIndependentValidator());
  Reflect.set(runtime, "authoritativeSessionValidationReady", true);
  // The lifecycle guards are bypassed ONLY in this headless unit harness.
  Reflect.set(runtime, "assertUsable", () => undefined);
  Reflect.set(runtime, "assertCameraRunning", () => undefined);
  return runtime;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detached quick recalibration transaction", () => {
  it("preserves the installed model, restores every coupled object on abort and rejects stale retries", () => {
    vi.stubGlobal("window", globalThis);
    const manager = fittedCalibration();
    const runtime = createRuntime(manager);
    const original = {
      manager: runtimeField(runtime, "calibrationManager"),
      mapper: runtimeField(runtime, "deepPersonalMapper"),
      selector: runtimeField(runtime, "calibrationHybridSelector"),
      corrector: runtimeField(runtime, "residualCorrector"),
      validation: runtimeField(runtime, "validationManager"),
      deepValidator: runtimeField(runtime, "deepIndependentValidator")
    };
    const model = manager.getModel();
    const first = runtime.startQuickRecalibration("quick_test", 5);
    expect(first.startingPointIndex).toBe(17);
    expect(first.expectedPointCount).toBe(22);
    expect(runtimeField(runtime, "calibrationManager")).not.toBe(manager);
    expect(manager.getModel()).toBe(model);
    expect(manager.getSnapshot().modelReady).toBe(true);
    expect(runtime.abortQuickRecalibration("quick_test", `${first.runId}:stale`)).toBe(false);
    expect(runtime.abortQuickRecalibration("quick_test", first.runId)).toBe(true);
    expect(runtimeField(runtime, "calibrationManager")).toBe(original.manager);
    expect(runtimeField(runtime, "deepPersonalMapper")).toBe(original.mapper);
    expect(runtimeField(runtime, "calibrationHybridSelector")).toBe(original.selector);
    expect(runtimeField(runtime, "residualCorrector")).toBe(original.corrector);
    expect(runtimeField(runtime, "validationManager")).toBe(original.validation);
    expect(runtimeField(runtime, "deepIndependentValidator")).toBe(original.deepValidator);
    expect(runtimeField(runtime, "authoritativeSessionValidationReady")).toBe(true);
    expect(manager.getSnapshot().expectedPointCount).toBe(17);
    const second = runtime.startQuickRecalibration("quick_test", 5);
    expect(second.runId).not.toBe(first.runId);
    expect(runtime.abortQuickRecalibration("quick_test", first.runId)).toBe(false);
    runtime.handlePageContextTransition();
    expect(runtimeField(runtime, "quickRecalibrationActive")).toBe(false);
    expect(runtimeField(runtime, "calibrationManager")).toBe(manager);
  });

  it("reports failed independent revalidation without publishing the rejected candidate", () => {
    vi.stubGlobal("window", globalThis);
    const manager = fittedCalibration();
    const runtime = createRuntime(manager);
    const started = runtime.startQuickRecalibration("quick_test", 5);
    const candidate = runtimeField(runtime, "calibrationManager") as CalibrationManager;
    const previousModel = manager.getModel();
    if (previousModel === null) throw new Error("Baseline model missing.");
    // Emulate a finished maintenance fit so this test can isolate validation commit.
    candidate.setModel(previousModel);
    runtime.startQuickValidation("quick_test", VIEWPORT.width, VIEWPORT.height, 3);
    const validator = runtimeField(runtime, "validationManager") as ValidationManager;
    const targets = createQuickValidationPattern(VIEWPORT);
    for (const target of targets) {
      const t = 1000 + target.pointIndex * 2000;
      collectStableSamples(validator, target, { x: 0.1, y: 0.1 }, t);
      if (target.pointIndex < 2) {
        expect(validator.finishActivePoint(t + 1300).sufficient).toBe(true);
      } else {
        let resultQuality: string | null = null;
        Reflect.set(runtime, "activeValidationPointRequest", {
          calibrationId: "quick_test", pointIndex: target.pointIndex,
          targetNormalizedPoint: target.normalizedPoint,
          targetViewportPoint: target.viewportPoint,
          targetShownAtMs: t,
          resolve: (result: { validation: { quality: string } | null }) => {
            resultQuality = result.validation?.quality ?? null;
          },
          reject: (error: unknown) => { throw error; },
          timeoutId: 0, deepGraceTimeoutId: null, baselineReadyAtMs: null,
          baselineResult: null
        });
        finishActiveValidationPoint(runtime);
        expect(resultQuality).not.toBe("GOOD");
        expect(resultQuality).not.toBe("ACCEPTABLE");
      }
    }
    expect(runtimeField(runtime, "calibrationManager")).toBe(manager);
    expect(manager.getModel()).toBe(previousModel);
    expect(runtimeField(runtime, "quickRecalibrationActive")).toBe(false);
    expect(runtime.getCompletedQuickValidationResult()?.quality).not.toBe("GOOD");
    expect(runtime.abortQuickRecalibration("quick_test", started.runId)).toBe(false);
  });
});
