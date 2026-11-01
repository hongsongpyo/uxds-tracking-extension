import {
  AOI,
  PRIVACY_DEFAULTS,
  RUNTIME_LIMITS
} from "../shared/constants";

import {
  nowEpochMs
} from "../shared/utils";

import type {
  AoiHit,
  AoiHitCandidate,
  AoiId,
  AoiRegistryEntry,
  AoiType,
  PageId,
  Point2D,
  Rect2D,
  TextStoragePolicy
} from "../shared/types";

const INTERACTIVE_ROLES = new Set<string>([
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "option",
  "switch",
  "textbox",
  "combobox"
]);

const TEXT_TAGS = new Set<string>([
  "p",
  "span",
  "label",
  "li",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em"
]);

const EXTENSION_HOST_IDS = new Set<string>([
  "etc-calibration-overlay-host",
  "etc-precalibration-overlay-host",
  "etc-gaze-overlay"
]);

export interface DomAoiResolution {
  readonly hit: AoiHit;
  readonly upserted: readonly AoiRegistryEntry[];
  readonly removedAoiIds: readonly AoiId[];
}

interface RegisteredElement {
  readonly element: Element;
  entry: AoiRegistryEntry;
  signature: string;
}

interface ScoredElement {
  readonly element: Element;
  readonly inside: boolean;
  readonly distancePx: number;
  readonly score: number;
  readonly centerHit: boolean;
  readonly semanticPriority: number;
  readonly domDepth: number;
  readonly areaPx2: number;
}

function normalizedAttribute(
  element: Element,
  name: string
): string | null {
  const value = element.getAttribute(name)?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function isInteractiveElement(
  element: Element
): boolean {
  const tag = element.tagName.toLowerCase();

  if (
    tag === "button"
    || tag === "a"
    || tag === "input"
    || tag === "textarea"
    || tag === "select"
    || tag === "summary"
  ) {
    return true;
  }

  const role = normalizedAttribute(element, "role")?.toLowerCase() ?? null;
  return role !== null && INTERACTIVE_ROLES.has(role);
}

export function classifyAoiType(
  tagName: string,
  role: string | null,
  inputType: string | null,
  interactive: boolean
): AoiType {
  const tag = tagName.toLowerCase();
  const normalizedRole = role?.toLowerCase() ?? null;
  const normalizedInputType = inputType?.toLowerCase() ?? null;

  if (tag === "button" || normalizedRole === "button") return "BUTTON";
  if (tag === "a" || normalizedRole === "link") return "LINK";
  if (tag === "textarea") return "TEXTAREA";
  if (tag === "select" || normalizedRole === "combobox") return "SELECT";
  if (tag === "img" || tag === "picture") return "IMAGE";
  if (tag === "video") return "VIDEO";
  if (tag === "canvas") return "CANVAS";
  if (tag === "iframe") return "IFRAME";
  if (normalizedRole === "tab") return "TAB";
  if (normalizedRole === "menuitem") return "MENU_ITEM";

  if (tag === "input") {
    if (normalizedInputType === "checkbox") return "CHECKBOX";
    if (normalizedInputType === "radio") return "RADIO";
    return "INPUT";
  }

  if (normalizedRole === "checkbox") return "CHECKBOX";
  if (normalizedRole === "radio") return "RADIO";
  if (TEXT_TAGS.has(tag)) return "TEXT";
  if (interactive || normalizedRole !== null) return "CUSTOM";
  if (tag === "div" || tag === "section" || tag === "article" || tag === "nav") {
    return "CONTAINER";
  }

  return "UNKNOWN";
}

export function distancePointToRect(
  point: Point2D,
  rect: Rect2D
): number {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;

  const dx =
    point.x < rect.left
      ? rect.left - point.x
      : point.x > right
        ? point.x - right
        : 0;

  const dy =
    point.y < rect.top
      ? rect.top - point.y
      : point.y > bottom
        ? point.y - bottom
        : 0;

  return Math.hypot(dx, dy);
}

function pointInsideRect(
  point: Point2D,
  rect: Rect2D
): boolean {
  return (
    point.x >= rect.left
    && point.x <= rect.left + rect.width
    && point.y >= rect.top
    && point.y <= rect.top + rect.height
  );
}

function isExtensionOwnedElement(
  element: Element
): boolean {
  let current: Element | null = element;

  for (let depth = 0; current !== null && depth <= AOI.MAX_INTERACTIVE_ANCESTOR_DEPTH; depth += 1) {
    const id = current.id;

    if (
      EXTENSION_HOST_IDS.has(id)
      || id.startsWith("etc-")
      || current.hasAttribute("data-eye-tracker-overlay")
    ) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function hasMeaningfulText(
  element: Element
): boolean {
  const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.length > 0;
}

function isMeaningfulAoiElement(
  element: Element
): boolean {
  if (isExtensionOwnedElement(element)) return false;

  const tag = element.tagName.toLowerCase();
  const role = normalizedAttribute(element, "role");

  if (isInteractiveElement(element)) return true;

  if (
    tag === "img"
    || tag === "video"
    || tag === "canvas"
    || tag === "iframe"
  ) {
    return true;
  }

  if (role !== null) return true;
  if (TEXT_TAGS.has(tag) && hasMeaningfulText(element)) return true;

  return false;
}

function resolveSemanticElement(
  element: Element
): Element | null {
  let current: Element | null = element;
  let textFallback: Element | null = null;

  for (
    let depth = 0;
    current !== null && depth <= AOI.MAX_INTERACTIVE_ANCESTOR_DEPTH;
    depth += 1
  ) {
    if (isExtensionOwnedElement(current)) return null;

    if (isInteractiveElement(current)) return current;

    if (textFallback === null && isMeaningfulAoiElement(current)) {
      textFallback = current;
    }

    current = current.parentElement;
  }

  return textFallback;
}

function semanticPriorityForElement(
  element: Element
): number {
  if (isInteractiveElement(element)) return 5;

  const tagName = element.tagName.toLowerCase();
  const role = normalizedAttribute(element, "role");
  const inputType = tagName === "input"
    ? normalizedAttribute(element, "type")
    : null;
  const aoiType = classifyAoiType(tagName, role, inputType, false);

  switch (aoiType) {
    case "IMAGE":
    case "VIDEO":
    case "CANVAS":
    case "IFRAME":
      return 4;
    case "TEXT":
      return 3;
    case "CUSTOM":
      return 2;
    case "CONTAINER":
      return 1;
    default:
      return 0;
  }
}

function elementDomDepth(
  element: Element
): number {
  let depth = 0;
  let current: Element | null = element.parentElement;

  while (current !== null) {
    depth += 1;
    current = current.parentElement;
  }

  return depth;
}

function rectFromDomRect(
  rect: DOMRect
): Rect2D {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function isVisibleElement(
  element: Element,
  rect: Rect2D
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  return (
    style.display !== "none"
    && style.visibility !== "hidden"
    && style.visibility !== "collapse"
    && Number.parseFloat(style.opacity || "1") > 0
  );
}

function escapeAttributeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\a ");
}

function nthOfTypeIndex(element: Element): number {
  let index = 1;
  let sibling = element.previousElementSibling;

  while (sibling !== null) {
    if (sibling.tagName === element.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }

  return index;
}

function createDomPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current !== null) {
    const tag = current.tagName.toLowerCase();

    if (current.id.trim().length > 0) {
      segments.unshift(`${tag}[id="${escapeAttributeValue(current.id)}"]`);
      break;
    }

    segments.unshift(`${tag}:nth-of-type(${nthOfTypeIndex(current)})`);

    if (tag === "html") break;
    current = current.parentElement;
  }

  return segments.join(" > ");
}

function extractText(element: Element): string | null {
  const value = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (value.length === 0) return null;
  return value.slice(0, RUNTIME_LIMITS.MAX_AOI_TEXT_LENGTH);
}

async function sha256Text(value: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return null;

  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function entrySignature(entry: AoiRegistryEntry): string {
  return JSON.stringify({
    tagName: entry.tagName,
    elementId: entry.elementId,
    role: entry.role,
    ariaLabel: entry.ariaLabel,
    elementName: entry.elementName,
    textLabel: entry.textLabel,
    textHash: entry.textHash,
    cssSelector: entry.cssSelector,
    domPath: entry.domPath,
    aoiType: entry.aoiType,
    interactive: entry.interactive,
    viewportRect: entry.viewportRect,
    documentRect: entry.documentRect,
    visible: entry.visible,
    enabled: entry.enabled,
    textStoragePolicy: entry.textStoragePolicy
  });
}

export class DomAoiResolver {
  private readonly elementIds = new WeakMap<Element, AoiId>();
  private readonly registered = new Map<AoiId, RegisteredElement>();
  private readonly textHashCache = new Map<string, string | null>();
  private nextAoiSequence = 1;

  public constructor(
    private readonly pageId: PageId,
    private readonly browserFrameId: number,
    private readonly textStoragePolicy: TextStoragePolicy =
      PRIVACY_DEFAULTS.DEFAULT_TEXT_STORAGE_POLICY
  ) {}

  public async resolve(
    timestampMs: number,
    viewportPoint: Point2D
  ): Promise<DomAoiResolution> {
    const removedAoiIds = this.collectDisconnectedAois();

    if (
      viewportPoint.x < 0
      || viewportPoint.y < 0
      || viewportPoint.x > window.innerWidth
      || viewportPoint.y > window.innerHeight
    ) {
      return {
        hit: {
          timestampMs,
          primaryAoiId: null,
          candidates: []
        },
        upserted: [],
        removedAoiIds
      };
    }

    const scored = this.collectScoredElements(viewportPoint);
    const upserted: AoiRegistryEntry[] = [];
    const candidates: AoiHitCandidate[] = [];

    const retained = scored.slice(0, AOI.MAX_HIT_CANDIDATES);
    const totalScore = retained.reduce((sum, item) => sum + item.score, 0);

    for (const item of retained) {
      const entry = await this.upsertElement(item.element);

      if (entry.changed) upserted.push(entry.value);

      candidates.push({
        aoiId: entry.value.aoiId,
        probability: totalScore > 0 ? item.score / totalScore : 0,
        distancePx: item.distancePx,
        inside: item.inside
      });
    }

    return {
      hit: {
        timestampMs,
        primaryAoiId: candidates[0]?.aoiId ?? null,
        candidates
      },
      upserted,
      removedAoiIds
    };
  }

  private collectScoredElements(viewportPoint: Point2D): ScoredElement[] {
    const radius = AOI.DEFAULT_SEARCH_RADIUS_PX;
    const diagonal = radius / Math.SQRT2;
    const offsets: readonly Point2D[] = [
      { x: 0, y: 0 },
      { x: radius, y: 0 },
      { x: -radius, y: 0 },
      { x: 0, y: radius },
      { x: 0, y: -radius },
      { x: diagonal, y: diagonal },
      { x: diagonal, y: -diagonal },
      { x: -diagonal, y: diagonal },
      { x: -diagonal, y: -diagonal }
    ];

    const candidateMap = new Map<Element, { centerHit: boolean }>();

    for (const offset of offsets) {
      const x = Math.min(Math.max(viewportPoint.x + offset.x, 0), Math.max(window.innerWidth - 1, 0));
      const y = Math.min(Math.max(viewportPoint.y + offset.y, 0), Math.max(window.innerHeight - 1, 0));

      const elements = document.elementsFromPoint(x, y);

      for (const rawElement of elements) {
        const semantic = resolveSemanticElement(rawElement);
        if (semantic === null) continue;

        const existing = candidateMap.get(semantic);
        const centerHit = offset.x === 0 && offset.y === 0;

        if (existing === undefined) {
          candidateMap.set(semantic, { centerHit });
        } else if (centerHit && !existing.centerHit) {
          candidateMap.set(semantic, { centerHit: true });
        }
      }
    }

    const scored: ScoredElement[] = [];

    for (const [element, metadata] of candidateMap) {
      const rect = rectFromDomRect(element.getBoundingClientRect());
      if (!isVisibleElement(element, rect)) continue;

      const distancePx = distancePointToRect(viewportPoint, rect);
      if (distancePx > radius) continue;

      const inside = pointInsideRect(viewportPoint, rect);
      const proximity = inside ? 1 : Math.max(0, 1 - distancePx / radius);
      const semanticPriority = semanticPriorityForElement(element);
      const interactiveBoost = isInteractiveElement(element) ? 1.15 : 1;
      const centerBoost = metadata.centerHit ? 1.2 : 1;
      const score = Math.max(0.001, proximity * interactiveBoost * centerBoost);

      scored.push({
        element,
        inside,
        distancePx,
        score,
        centerHit: metadata.centerHit,
        semanticPriority,
        domDepth: elementDomDepth(element),
        areaPx2: Math.max(1, rect.width * rect.height)
      });
    }

    scored.sort((a, b) => {
      if (a.inside !== b.inside) return a.inside ? -1 : 1;

      if (a.inside && b.inside) {
        if (a.centerHit !== b.centerHit) return a.centerHit ? -1 : 1;
        if (a.semanticPriority !== b.semanticPriority) {
          return b.semanticPriority - a.semanticPriority;
        }
        if (a.domDepth !== b.domDepth) return b.domDepth - a.domDepth;
        if (a.areaPx2 !== b.areaPx2) return a.areaPx2 - b.areaPx2;
      }

      if (a.score !== b.score) return b.score - a.score;
      if (a.distancePx !== b.distancePx) return a.distancePx - b.distancePx;
      if (a.semanticPriority !== b.semanticPriority) {
        return b.semanticPriority - a.semanticPriority;
      }
      if (a.domDepth !== b.domDepth) return b.domDepth - a.domDepth;
      return a.areaPx2 - b.areaPx2;
    });

    return scored;
  }

  private async upsertElement(
    element: Element
  ): Promise<{ value: AoiRegistryEntry; changed: boolean }> {
    let aoiId = this.elementIds.get(element);

    if (aoiId === undefined) {
      aoiId = `aoi_${this.pageId}_${this.browserFrameId}_${this.nextAoiSequence}`;
      this.nextAoiSequence += 1;
      this.elementIds.set(element, aoiId);
    }

    const previous = this.registered.get(aoiId);
    const createdAtEpochMs = previous?.entry.createdAtEpochMs ?? nowEpochMs();
    const entry = await this.createRegistryEntry(element, aoiId, createdAtEpochMs);
    const signature = entrySignature(entry);
    const changed = previous === undefined || previous.signature !== signature;

    this.registered.set(aoiId, {
      element,
      entry,
      signature
    });

    return { value: entry, changed };
  }

  private async createRegistryEntry(
    element: Element,
    aoiId: AoiId,
    createdAtEpochMs: number
  ): Promise<AoiRegistryEntry> {
    const rect = rectFromDomRect(element.getBoundingClientRect());
    const role = normalizedAttribute(element, "role");
    const interactive = isInteractiveElement(element);
    const text = extractText(element);

    let textLabel: string | null = null;
    let textHash: string | null = null;

    if (text !== null) {
      if (this.textStoragePolicy === "RAW") {
        textLabel = text;
      } else if (this.textStoragePolicy === "HASHED") {
        if (!this.textHashCache.has(text)) {
          this.textHashCache.set(text, await sha256Text(text));
        }
        textHash = this.textHashCache.get(text) ?? null;
      }
    }

    const tagName = element.tagName.toLowerCase();
    const inputType = tagName === "input" ? normalizedAttribute(element, "type") : null;
    const domPath = createDomPath(element);

    return {
      aoiId,
      pageId: this.pageId,
      browserFrameId: this.browserFrameId,
      tagName,
      elementId: element.id.trim().length > 0 ? element.id : null,
      role,
      ariaLabel: normalizedAttribute(element, "aria-label"),
      elementName: normalizedAttribute(element, "name"),
      textLabel,
      textHash,
      cssSelector: domPath,
      domPath,
      aoiType: classifyAoiType(tagName, role, inputType, interactive),
      interactive,
      viewportRect: rect,
      documentRect: {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height
      },
      visible: isVisibleElement(element, rect),
      enabled:
        !element.hasAttribute("disabled")
        && normalizedAttribute(element, "aria-disabled") !== "true",
      textStoragePolicy: this.textStoragePolicy,
      createdAtEpochMs,
      updatedAtEpochMs: nowEpochMs()
    };
  }

  private collectDisconnectedAois(): AoiId[] {
    const removed: AoiId[] = [];

    for (const [aoiId, registered] of this.registered) {
      if (registered.element.isConnected) continue;
      this.registered.delete(aoiId);
      removed.push(aoiId);
    }

    return removed;
  }
}
