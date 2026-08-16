/**
 * Inline SVG icons built with the SVG namespace.
 *
 * These are static marks (no dynamic content), constructed via DOM APIs so the
 * codebase never depends on a raw-HTML helper. Stroke widths and geometry track
 * the warm-gray/neutral visual baseline.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(children: ReadonlyArray<SVGElement>): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  for (const child of children) el.append(child);
  return el;
}

function path(d: string): SVGPathElement {
  const el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', d);
  return el;
}

function circle(cx: number, cy: number, r: number): SVGCircleElement {
  const el = document.createElementNS(SVG_NS, 'circle');
  el.setAttribute('cx', String(cx));
  el.setAttribute('cy', String(cy));
  el.setAttribute('r', String(r));
  return el;
}

/** Two-arrow circular "refresh / retry" glyph. */
export function refreshIcon(): SVGSVGElement {
  return svg([
    path('M3 12a9 9 0 0 1 15-6.7L21 8'),
    path('M21 3v5h-5'),
    path('M21 12a9 9 0 0 1-15 6.7L3 16'),
    path('M3 21v-5h5'),
  ]);
}

/** Hourglass-style "reset" glyph for Codex rate-limit resets. */
export function resetIcon(): SVGSVGElement {
  return svg([
    path('M6 3h12'),
    path('M6 21h12'),
    path('M6 3v4l6 5-6 5v4'),
    path('M18 3v4l-6 5 6 5v4'),
  ]);
}

/** Shield with a check, used on the admin-only identity badge. */
export function adminIcon(): SVGSVGElement {
  return svg([
    path('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10'),
    path('m9 12 2 2 4-4'),
  ]);
}

/** Sun glyph for the theme toggle (shown in light mode). */
export function sunIcon(): SVGSVGElement {
  return svg([
    circle(12, 12, 4),
    path('M12 2v2'),
    path('M12 20v2'),
    path('m4.93 4.93 1.41 1.41'),
    path('m17.66 17.66 1.41 1.41'),
    path('M2 12h2'),
    path('M20 12h2'),
    path('m6.34 17.66-1.41 1.41'),
    path('m19.07 4.93-1.41 1.41'),
  ]);
}

/** Moon glyph for the theme toggle (shown in dark mode). */
export function moonIcon(): SVGSVGElement {
  return svg([path('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z')]);
}
