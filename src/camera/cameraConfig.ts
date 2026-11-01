import {
  CAMERA_DEFAULTS
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import {
  isNonEmptyString,
  isPositiveFiniteNumber,
  isRecord
} from "../shared/utils";

import type {
  CameraSettings
} from "../shared/types";

/* ========================================================================== 
 * Camera request
 * ======================================================================== */

/**
 * Camera-domain request independent from Chrome runtime messages.
 *
 * The shape intentionally mirrors StartCameraPayload, but the camera module
 * does not depend on the messaging layer.
 */
export interface CameraRequest {
  preferredWidth: number;
  preferredHeight: number;
  preferredFrameRate: number;

  preferredDeviceId: string | null;
}

export const DEFAULT_CAMERA_REQUEST:
Readonly<CameraRequest> = {
  preferredWidth:
    CAMERA_DEFAULTS.WIDTH,

  preferredHeight:
    CAMERA_DEFAULTS.HEIGHT,

  preferredFrameRate:
    CAMERA_DEFAULTS.FRAME_RATE,

  preferredDeviceId:
    null
};

/* ========================================================================== 
 * Runtime guards
 * ======================================================================== */

export function isCameraRequest(
  value: unknown
): value is CameraRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveFiniteNumber(
      value.preferredWidth
    )
    && isPositiveFiniteNumber(
      value.preferredHeight
    )
    && isPositiveFiniteNumber(
      value.preferredFrameRate
    )
    && (
      value.preferredDeviceId
        === null
      || isNonEmptyString(
        value.preferredDeviceId
      )
    )
  );
}

export function isCameraSettings(
  value: unknown
): value is CameraSettings {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveFiniteNumber(
      value.width
    )
    && isPositiveFiniteNumber(
      value.height
    )
    && isPositiveFiniteNumber(
      value.frameRate
    )
    && (
      value.deviceId === null
      || typeof value.deviceId
        === "string"
    )
    && (
      value.facingMode === null
      || typeof value.facingMode
        === "string"
    )
  );
}

/* ========================================================================== 
 * Request validation
 * ======================================================================== */

export function assertCameraRequest(
  request: CameraRequest
): void {
  if (isCameraRequest(request)) {
    return;
  }

  throw new TrackerError(
    ERROR_CODES
      .CAMERA_CONSTRAINT_UNSATISFIED,
    "CAMERA",
    "Camera request contains invalid preferred constraints."
  );
}

/* ========================================================================== 
 * Media constraints
 * ======================================================================== */

/**
 * Creates permissive "ideal" constraints.
 *
 * Width/height/frame-rate are preferences rather than exact requirements so
 * the browser may fall back to a nearby supported camera mode instead of
 * failing unnecessarily.
 */
export function createCameraConstraints(
  request: CameraRequest
): MediaStreamConstraints {
  assertCameraRequest(request);

  const videoConstraints:
  MediaTrackConstraints = {
    width: {
      ideal:
        request.preferredWidth
    },

    height: {
      ideal:
        request.preferredHeight
    },

    frameRate: {
      ideal:
        request.preferredFrameRate
    },

    facingMode: {
      ideal:
        CAMERA_DEFAULTS.FACING_MODE
    }
  };

  if (
    request.preferredDeviceId
    !== null
  ) {
    videoConstraints.deviceId = {
      ideal:
        request.preferredDeviceId
    };
  }

  return {
    audio: false,
    video: videoConstraints
  };
}

/* ========================================================================== 
 * Actual camera settings
 * ======================================================================== */

function getPositiveSetting(
  value: number | undefined,
  fallback: number
): number {
  if (
    value !== undefined
    && Number.isFinite(value)
    && value > 0
  ) {
    return value;
  }

  return fallback;
}

/**
 * Reads the settings actually selected by Chrome after getUserMedia().
 *
 * Track settings are preferred. The playing video element is used as a
 * fallback for dimensions, and the requested frame rate is used only when
 * the browser does not expose an actual frame-rate setting.
 */
export function readActualCameraSettings(
  track: MediaStreamTrack,
  videoElement: HTMLVideoElement,
  request: CameraRequest
): CameraSettings {
  const settings =
    track.getSettings();

  const width =
    getPositiveSetting(
      settings.width,
      videoElement.videoWidth
    );

  const height =
    getPositiveSetting(
      settings.height,
      videoElement.videoHeight
    );

  const frameRate =
    getPositiveSetting(
      settings.frameRate,
      request.preferredFrameRate
    );

  if (
    width <= 0
    || height <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.CAMERA_START_FAILED,
      "CAMERA",
      "Camera started without usable video dimensions.",
      {
        details: {
          trackWidth:
            settings.width
            ?? null,

          trackHeight:
            settings.height
            ?? null,

          videoWidth:
            videoElement.videoWidth,

          videoHeight:
            videoElement.videoHeight
        }
      }
    );
  }

  return {
    width,
    height,
    frameRate,

    deviceId:
      settings.deviceId
      ?? null,

    facingMode:
      settings.facingMode
      ?? null
  };
}
