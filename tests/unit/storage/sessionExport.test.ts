import {
  describe,
  expect,
  it
} from "vitest";

import {
  buildSessionExportFiles
} from "../../../src/storage/sessionExport";

import type {
  SessionExportData
} from "../../../src/storage/storageTypes";

function makeExportData(): SessionExportData {
  return {
    exportedAtEpochMs: 200,
    session: {
      sessionId: "session_test",
      session: {
        sessionId: "session_test",
        participantId: "participant_test",
        startedAtEpochMs: 100,
        endedAtEpochMs: null,
        durationMs: null,
        extensionVersion: "0.1.0",
        schemaVersion: 2,
        trackerVersion: "test",
        gazeEngine: "WEB_EYE_TRACK",
        browser: {
          browserName: "Chrome",
          browserVersion: "test",
          operatingSystem: "test",
          userAgent: "test"
        },
        screen: {
          width: 1920,
          height: 1080,
          availableWidth: 1920,
          availableHeight: 1080,
          devicePixelRatio: 1,
          orientationType: null,
          orientationAngleDeg: null
        },
        camera: null,
        calibrationProfileId: null
      },
      validation: null,
      updatedAtEpochMs: 100
    },
    gaze: [
      {
        recordId: "gaze_1",
        sessionId: "session_test",
        pageId: "page_1",
        tabId: 1,
        browserFrameId: 0,
        timestampMs: 50,
        capturedAtEpochMs: 150,
        pointSource: "FIXATION_CENTROID",
        coordinateSource: "STABILIZED_GAZE",
        gazeQuality: 0.9,
        degradedCollection: false,
        fixationId: "fixation_1",
        gazeNormalizedPoint: { x: 0.5, y: 0.25 },
        probeNormalizedPoint: { x: 0.51, y: 0.26 },
        rawPredictionNormalizedPoint: { x: 0.49, y: 0.24 },
        authoritativeNormalizedPoint: { x: 0.5, y: 0.25 },
        stabilizedNormalizedPoint: { x: 0.5, y: 0.25 },
        coordinates: {
          capturedAtEpochMs: 150,
          url: "https://example.test/page",
          origin: "https://example.test",
          viewportPoint: { x: 960, y: 270 },
          documentPoint: { x: 960, y: 1270 },
          insideViewport: true,
          viewportWidth: 1920,
          viewportHeight: 1080,
          documentWidth: 1920,
          documentHeight: 3000,
          scrollX: 0,
          scrollY: 1000,
          devicePixelRatio: 1
        },
        aoiProbeCoordinates: {
          capturedAtEpochMs: 150,
          url: "https://example.test/page",
          origin: "https://example.test",
          viewportPoint: { x: 979.2, y: 280.8 },
          documentPoint: { x: 979.2, y: 1280.8 },
          insideViewport: true,
          viewportWidth: 1920,
          viewportHeight: 1080,
          documentWidth: 1920,
          documentHeight: 3000,
          scrollX: 0,
          scrollY: 1000,
          devicePixelRatio: 1
        },
        primaryAoiId: "aoi_1",
        candidates: [
          {
            aoiId: "aoi_1",
            probability: 0.95,
            distancePx: 0,
            inside: true
          }
        ]
      }
    ],
    fixations: [
      {
        recordId: "fixation_1",
        sessionId: "session_test",
        pageId: "page_1",
        event: {
          fixationId: "fixation_1",
          sessionId: "session_test",
          pageId: "page_1",
          startTimeMs: 0,
          endTimeMs: 200,
          durationMs: 200,
          centroidViewportPoint: { x: 960, y: 270 },
          dispersionX: 20,
          dispersionY: 10,
          dispersionPx: 22.36,
          sampleCount: 5,
          qualityMean: 0.9,
          aoiId: null,
          aoiDwellRatio: 0
        },
        peakSpeedPxPerSecond: 120,
        capturedAtEpochMs: 200,
        coordinates: {
          capturedAtEpochMs: 200,
          url: "https://example.test/page",
          origin: "https://example.test",
          viewportPoint: { x: 960, y: 270 },
          documentPoint: { x: 960, y: 1270 },
          insideViewport: true,
          viewportWidth: 1920,
          viewportHeight: 1080,
          documentWidth: 1920,
          documentHeight: 3000,
          scrollX: 0,
          scrollY: 1000,
          devicePixelRatio: 1
        },
        primaryAoiId: "aoi_1",
        candidates: [
          {
            aoiId: "aoi_1",
            probability: 0.95,
            distancePx: 0,
            inside: true
          }
        ]
      }
    ],
    scroll: [],
    navigation: [],
    diagnostics: [],
    aoiRegistry: [
      {
        recordId: "session_test::aoi_1",
        sessionId: "session_test",
        pageId: "page_1",
        entry: {
          aoiId: "aoi_1",
          pageId: "page_1",
          browserFrameId: 0,
          tagName: "button",
          elementId: "buy",
          role: null,
          ariaLabel: "Buy",
          elementName: null,
          textLabel: null,
          textHash: "hash",
          cssSelector: "#buy",
          domPath: "html>body>button",
          aoiType: "BUTTON",
          interactive: true,
          viewportRect: {
            left: 900,
            top: 240,
            width: 120,
            height: 60
          },
          documentRect: {
            left: 900,
            top: 1240,
            width: 120,
            height: 60
          },
          visible: true,
          enabled: true,
          textStoragePolicy: "HASHED",
          createdAtEpochMs: 120,
          updatedAtEpochMs: 150
        }
      }
    ]
  };
}

describe("D25 session export", () => {
  it("exports gaze and fixation coordinates in CSV tables", () => {
    const files = buildSessionExportFiles(
      makeExportData(),
      "CSV"
    );

    const gaze = files.find((file) =>
      file.filename.endsWith("_gaze.csv")
    );
    const fixations = files.find((file) =>
      file.filename.endsWith("_fixations.csv")
    );

    expect(gaze?.content).toContain("coordinate_source,aoi_point_source");
    expect(gaze?.content).toContain("aoi_probe_viewport_x");
    expect(gaze?.content).toContain("0.5,0.25,0.49,0.24,0.5,0.25,0.5,0.25,960,1270,979.2,280.8,0.51,0.26,979.2,1280.8");
    expect(gaze?.content).toContain("aoi_1,BUTTON,button");

    expect(fixations?.content).toContain(
      "fixation_1,session_test,page_1"
    );
    expect(fixations?.content).toContain(
      ",960,1270,20,10,22.36,"
    );
  });

  it("exports an enriched fixation even when no regular gaze probe linked to it", () => {
    const data = makeExportData();
    const files = buildSessionExportFiles(
      {
        ...data,
        gaze: []
      },
      "CSV"
    );

    const fixations = files.find((file) =>
      file.filename.endsWith("_fixations.csv")
    );

    expect(fixations?.content).toContain(
      ",960,1270,20,10,22.36,"
    );
    expect(fixations?.content).toContain(
      ",aoi_1,BUTTON,button,0"
    );
  });

  it("preserves nested candidate data in JSON", () => {
    const files = buildSessionExportFiles(
      makeExportData(),
      "JSON"
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.content).toContain(
      '"probability": 0.95'
    );
    expect(files[0]?.content).toContain(
      '"primaryAoiId": "aoi_1"'
    );
  });
});
