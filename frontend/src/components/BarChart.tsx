/**
 * A horizontal bar chart for one series.
 *
 * WHY HORIZONTAL. Every use here is labelled by a person or a department, and
 * those names are long. Vertical columns would either truncate them or rotate
 * them to 45°, which is the most common way a chart stops being readable.
 *
 * WHY NO CHARTING LIBRARY. A single-series bar is a rectangle whose width is a
 * fraction of the largest value: one division and a percentage. A library
 * would bring an axis model, a scale abstraction and a rendering layer to do
 * that, and would have to be configured back down to these specs anyway.
 *
 * WHY ONE HUE AND NO LEGEND. One series means colour carries no identity — the
 * heading already says what is plotted — so a legend box with a single swatch
 * would restate the title and cost space. The hue is the sequential blue
 * validated against both surfaces; identity never rests on colour here because
 * every bar is labelled.
 *
 * WHY THE VALUES ARE LABELLED BUT THE AXIS IS NOT DRAWN. These are rankings
 * read one row at a time, not trends read across a scale. A number beside each
 * bar answers "how much" directly; a gridded axis would add ink to approximate
 * what the label states exactly. The reference line is the exception — it is a
 * comparison every bar is read against, so it is drawn.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface BarDatum {
  label: string;
  value: number;
  /** Shown beside the bar; defaults to the value. */
  display?: string;
}

interface Props {
  data: BarDatum[];
  /** Drawn across every bar — a mean, a target — with its own caption. */
  reference?: { value: number; label: string };
  /** Announced to screen readers as the chart's purpose. */
  caption: string;
}

/**
 * Sequential blue, validated on both surfaces (light `#2a78d6` / dark
 * `#3987e5`). Declared as a CSS variable pair rather than picked in JS so dark
 * mode is a stylesheet decision, not a re-render.
 */
const BAR_FILL = 'var(--chart-bar, #2a78d6)';

const BarChart: React.FC<Props> = ({ data, reference, caption }) => {
  if (data.length === 0) return null;

  // The scale spans the largest bar AND the reference, so a mean above every
  // bar is still on the chart rather than clipped off the end.
  const max = Math.max(...data.map((d) => d.value), reference?.value ?? 0, 1);
  const widthOf = (value: number) => `${Math.max((value / max) * 100, 0)}%`;

  return (
    <figure className="mb-0" role="group" aria-label={caption}>
      <div className="position-relative">
        {reference && (
          <div
            className="position-absolute top-0 bottom-0 border-start border-secondary"
            // Hairline and recessive: it is context for the bars, not a mark
            // competing with them.
            style={{ left: widthOf(reference.value), opacity: 0.5 }}
            aria-hidden="true"
          />
        )}
        {data.map((d) => (
          <div key={d.label} className="d-flex align-items-center mb-1" style={{ gap: 8 }}>
            <span className="text-truncate" style={{ width: '32%' }} title={d.label}>
              {d.label}
            </span>
            <span className="flex-grow-1">
              <span
                className="d-block chart-bar"
                style={{
                  width: widthOf(d.value),
                  // Capped, and rounded only at the data end: the baseline is
                  // where every bar starts and a rounded start would soften
                  // the one edge that must read as exact.
                  height: 16,
                  backgroundColor: BAR_FILL,
                  borderRadius: '0 4px 4px 0',
                }}
                title={`${d.label}: ${d.display ?? d.value}`}
              />
            </span>
            <span className="text-muted small" style={{ minWidth: 64, textAlign: 'right' }}>
              {d.display ?? d.value}
            </span>
          </div>
        ))}
      </div>
      {reference && (
        <figcaption className="text-muted small mt-1">
          Vertical line: {reference.label}
        </figcaption>
      )}
    </figure>
  );
};

export default BarChart;
