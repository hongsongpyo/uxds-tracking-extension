import type {
  ExportedTextFile,
  SessionExportData,
  StoredAoiRecord,
  StoredGazeObservation
} from "./storageTypes";

function csvValueToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "symbol") {
    return value.description ?? "";
  }

  if (typeof value === "function") {
    return value.name;
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function csvCell(value: unknown): string {
  const text = csvValueToText(value);

  if (!/[",\n\r]/u.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

function buildAoiMap(
  records: readonly StoredAoiRecord[]
): ReadonlyMap<string, StoredAoiRecord> {
  const map = new Map<string, StoredAoiRecord>();

  for (const record of records) {
    map.set(record.entry.aoiId, record);
  }

  return map;
}

function buildGazeCsv(data: SessionExportData): string {
  const aoiMap = buildAoiMap(data.aoiRegistry);

  const lines: string[] = [
    csvRow([
      "timestamp_ms",
      "captured_epoch_ms",
      "session_id",
      "page_id",
      "tab_id",
      "browser_frame_id",
      "url",
      "coordinate_source",
      "aoi_point_source",
      "fixation_id",
      "gaze_quality",
      "degraded_collection",
      "viewport_x",
      "viewport_y",
      "normalized_x",
      "normalized_y",
      "raw_prediction_normalized_x",
      "raw_prediction_normalized_y",
      "authoritative_normalized_x",
      "authoritative_normalized_y",
      "stabilized_normalized_x",
      "stabilized_normalized_y",
      "document_x",
      "document_y",
      "aoi_probe_viewport_x",
      "aoi_probe_viewport_y",
      "aoi_probe_normalized_x",
      "aoi_probe_normalized_y",
      "aoi_probe_document_x",
      "aoi_probe_document_y",
      "scroll_x",
      "scroll_y",
      "viewport_width",
      "viewport_height",
      "document_width",
      "document_height",
      "inside_viewport",
      "primary_aoi_id",
      "primary_aoi_type",
      "primary_tag_name",
      "primary_role",
      "primary_element_id",
      "primary_aria_label",
      "candidate_count"
    ])
  ];

  for (const record of data.gaze) {
    const c = record.coordinates;
    const aoi =
      record.primaryAoiId === null
        ? null
        : aoiMap.get(record.primaryAoiId)?.entry ?? null;

    /** Backward-compatible fallbacks for D25 records created before D26. */
    const probeNormalizedPoint =
      record.probeNormalizedPoint
      ?? {
        x:
          c.viewportWidth > 0
            ? c.viewportPoint.x / c.viewportWidth
            : 0,
        y:
          c.viewportHeight > 0
            ? c.viewportPoint.y / c.viewportHeight
            : 0
      };

    const gazeNormalizedPoint =
      record.gazeNormalizedPoint
      ?? record.stabilizedNormalizedPoint
      ?? probeNormalizedPoint;

    const aoiCoordinates =
      record.aoiProbeCoordinates
      ?? c;

    const coordinateSource =
      record.coordinateSource
      ?? record.pointSource;

    lines.push(
      csvRow([
        record.timestampMs,
        record.capturedAtEpochMs,
        record.sessionId,
        record.pageId,
        record.tabId,
        record.browserFrameId,
        c.url,
        coordinateSource,
        record.pointSource,
        record.fixationId,
        record.gazeQuality,
        record.degradedCollection,
        c.viewportPoint.x,
        c.viewportPoint.y,
        gazeNormalizedPoint.x,
        gazeNormalizedPoint.y,
        record.rawPredictionNormalizedPoint?.x ?? null,
        record.rawPredictionNormalizedPoint?.y ?? null,
        record.authoritativeNormalizedPoint?.x ?? null,
        record.authoritativeNormalizedPoint?.y ?? null,
        record.stabilizedNormalizedPoint?.x ?? null,
        record.stabilizedNormalizedPoint?.y ?? null,
        c.documentPoint.x,
        c.documentPoint.y,
        aoiCoordinates.viewportPoint.x,
        aoiCoordinates.viewportPoint.y,
        probeNormalizedPoint.x,
        probeNormalizedPoint.y,
        aoiCoordinates.documentPoint.x,
        aoiCoordinates.documentPoint.y,
        c.scrollX,
        c.scrollY,
        c.viewportWidth,
        c.viewportHeight,
        c.documentWidth,
        c.documentHeight,
        c.insideViewport,
        record.primaryAoiId,
        aoi?.aoiType ?? null,
        aoi?.tagName ?? null,
        aoi?.role ?? null,
        aoi?.elementId ?? null,
        aoi?.ariaLabel ?? null,
        record.candidates.length
      ])
    );
  }

  return `${lines.join("\n")}\n`;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function modalAoiId(
  records: readonly StoredGazeObservation[]
): string | null {
  const counts = new Map<string, number>();

  for (const record of records) {
    if (record.primaryAoiId === null) continue;
    counts.set(
      record.primaryAoiId,
      (counts.get(record.primaryAoiId) ?? 0) + 1
    );
  }

  let winner: string | null = null;
  let winnerCount = 0;

  for (const [aoiId, count] of counts) {
    if (count > winnerCount) {
      winner = aoiId;
      winnerCount = count;
    }
  }

  return winner;
}

function buildFixationCsv(data: SessionExportData): string {
  const aoiMap = buildAoiMap(data.aoiRegistry);
  const gazeByFixation = new Map<string, StoredGazeObservation[]>();

  for (const gaze of data.gaze) {
    if (gaze.fixationId === null) continue;

    const list = gazeByFixation.get(gaze.fixationId) ?? [];
    list.push(gaze);
    gazeByFixation.set(gaze.fixationId, list);
  }

  const lines: string[] = [
    csvRow([
      "fixation_id",
      "session_id",
      "page_id",
      "start_time_ms",
      "end_time_ms",
      "duration_ms",
      "centroid_viewport_x",
      "centroid_viewport_y",
      "centroid_document_x",
      "centroid_document_y",
      "dispersion_x",
      "dispersion_y",
      "dispersion_px",
      "sample_count",
      "quality_mean",
      "peak_speed_px_per_second",
      "primary_aoi_id",
      "primary_aoi_type",
      "primary_aoi_tag",
      "linked_gaze_probe_count"
    ])
  ];

  for (const record of data.fixations) {
    const event = record.event;
    const linked = gazeByFixation.get(event.fixationId) ?? [];
    const documentX =
      record.coordinates?.documentPoint.x
      ?? mean(
        linked.map((item) => item.coordinates.documentPoint.x)
      );
    const documentY =
      record.coordinates?.documentPoint.y
      ?? mean(
        linked.map((item) => item.coordinates.documentPoint.y)
      );
    const primaryAoiId =
      record.primaryAoiId
      ?? modalAoiId(linked);
    const aoi =
      primaryAoiId === null
        ? null
        : aoiMap.get(primaryAoiId)?.entry ?? null;

    lines.push(
      csvRow([
        event.fixationId,
        record.sessionId,
        record.pageId,
        event.startTimeMs,
        event.endTimeMs,
        event.durationMs,
        event.centroidViewportPoint.x,
        event.centroidViewportPoint.y,
        documentX,
        documentY,
        event.dispersionX,
        event.dispersionY,
        event.dispersionPx,
        event.sampleCount,
        event.qualityMean,
        record.peakSpeedPxPerSecond,
        primaryAoiId,
        aoi?.aoiType ?? null,
        aoi?.tagName ?? null,
        linked.length
      ])
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildScrollCsv(data: SessionExportData): string {
  const lines: string[] = [
    csvRow([
      "timestamp_ms",
      "captured_epoch_ms",
      "session_id",
      "page_id",
      "tab_id",
      "browser_frame_id",
      "phase",
      "direction",
      "scroll_x",
      "scroll_y",
      "delta_x",
      "delta_y",
      "velocity_px_per_ms"
    ])
  ];

  for (const record of data.scroll) {
    const event = record.event;
    lines.push(
      csvRow([
        event.timestampMs,
        record.capturedAtEpochMs,
        record.sessionId,
        record.pageId,
        event.tabId,
        event.browserFrameId,
        event.phase,
        event.direction,
        event.scrollX,
        event.scrollY,
        event.deltaX,
        event.deltaY,
        event.velocityPxPerMs
      ])
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildAoiCsv(data: SessionExportData): string {
  const lines: string[] = [
    csvRow([
      "session_id",
      "page_id",
      "aoi_id",
      "aoi_type",
      "tag_name",
      "interactive",
      "element_id",
      "role",
      "aria_label",
      "element_name",
      "text_hash",
      "css_selector",
      "dom_path",
      "viewport_left",
      "viewport_top",
      "viewport_width",
      "viewport_height",
      "document_left",
      "document_top",
      "document_width",
      "document_height",
      "visible",
      "enabled"
    ])
  ];

  for (const record of data.aoiRegistry) {
    const entry = record.entry;
    lines.push(
      csvRow([
        record.sessionId,
        record.pageId,
        entry.aoiId,
        entry.aoiType,
        entry.tagName,
        entry.interactive,
        entry.elementId,
        entry.role,
        entry.ariaLabel,
        entry.elementName,
        entry.textHash,
        entry.cssSelector,
        entry.domPath,
        entry.viewportRect.left,
        entry.viewportRect.top,
        entry.viewportRect.width,
        entry.viewportRect.height,
        entry.documentRect.left,
        entry.documentRect.top,
        entry.documentRect.width,
        entry.documentRect.height,
        entry.visible,
        entry.enabled
      ])
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildNavigationCsv(data: SessionExportData): string {
  const lines: string[] = [
    csvRow([
      "captured_epoch_ms",
      "session_id",
      "page_id",
      "tab_id",
      "reason",
      "url"
    ])
  ];

  for (const record of data.navigation) {
    lines.push(
      csvRow([
        record.capturedAtEpochMs,
        record.sessionId,
        record.pageId,
        record.tabId,
        record.reason,
        record.url
      ])
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildDiagnosticsCsv(data: SessionExportData): string {
  const lines: string[] = [
    csvRow([
      "captured_epoch_ms", "session_id", "page_id", "kind", "code",
      "milestone", "elapsed_ms", "gaze_quality", "effective_gaze_quality",
      "baseline_precision_px", "deep_precision_px", "drift_severity",
      "precision_reference_px", "precision_ratio", "maintenance_reason",
      "periodic_maintenance_due", "monitoring_elapsed_ms",
      "face_center_delta_px", "face_distance_delta_ratio", "yaw_delta_deg",
      "pitch_delta_deg", "roll_delta_deg", "authoritative_strategy",
      "collection_allowed", "degraded_collection", "details_json"
    ])
  ];
  for (const record of data.diagnostics) {
    const d = record.diagnostic;
    lines.push(csvRow([
      record.capturedAtEpochMs, record.sessionId, record.pageId, record.kind, record.code,
      d?.milestone ?? null, d?.elapsedMs ?? null, d?.gazeQualityScore ?? null,
      d?.effectiveGazeQualityScore ?? null, d?.baselinePrecisionPx ?? null,
      d?.deepPrecisionPx ?? null, d?.driftStatus?.severity ?? null,
      d?.driftStatus?.precisionReferencePx ?? null, d?.driftStatus?.precisionRatio ?? null,
      d?.driftStatus?.maintenanceReason ?? null, d?.driftStatus?.periodicMaintenanceDue ?? null,
      d?.driftStatus?.monitoringElapsedMs ?? null,
      d?.driftStatus?.faceCenterDeltaPx ?? null, d?.driftStatus?.faceDistanceDeltaRatio ?? null,
      d?.driftStatus?.yawDeltaDeg ?? null, d?.driftStatus?.pitchDeltaDeg ?? null,
      d?.driftStatus?.rollDeltaDeg ?? null, d?.authoritativeStrategy ?? null,
      d?.collectionAllowed ?? null, d?.degradedCollection ?? null, record.details
    ]));
  }
  return `${lines.join("\n")}\n`;
}

function safeFilenamePart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/gu, "_");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "session";
}

export function buildSessionExportFiles(
  data: SessionExportData,
  format: "JSON" | "CSV"
): readonly ExportedTextFile[] {
  const sessionId = safeFilenamePart(data.session.sessionId);

  if (format === "JSON") {
    return [
      {
        filename: `eye-tracker_${sessionId}.json`,
        mimeType: "application/json;charset=utf-8",
        content: `${JSON.stringify(data, null, 2)}\n`
      }
    ];
  }

  return [
    {
      filename: `eye-tracker_${sessionId}_gaze.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildGazeCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_fixations.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildFixationCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_scroll.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildScrollCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_aoi.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildAoiCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_navigation.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildNavigationCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_diagnostics.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildDiagnosticsCsv(data)
    }
  ];
}
