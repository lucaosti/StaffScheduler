/**
 * Tiny SVG bar chart (F06).
 *
 * Pure presentational component — no chart library, no DOM measurement,
 * no animations. Inputs are an array of `{ label, value }` and a width;
 * we draw bars proportionally to the maximum value, with the value as
 * a label aligned right.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

export interface BarDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarDatum[];
  width?: number;
  rowHeight?: number;
  /** Number of decimal places to show on the value label. */
  valuePrecision?: number;
  /** Optional formatter; takes precedence over valuePrecision. */
  format?: (value: number) => string;
  ariaLabel?: string;
}

const LABEL_COL_WIDTH = 140;
const VALUE_COL_WIDTH = 60;
const PADDING = 8;

const BarChart: React.FC<BarChartProps> = ({
  data,
  width = 480,
  rowHeight = 24,
  valuePrecision = 0,
  format,
  ariaLabel = 'Bar chart',
}) => {
  if (data.length === 0) {
    return (
      <div className="text-muted small" role="status">
        No data
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const innerWidth = Math.max(120, width - LABEL_COL_WIDTH - VALUE_COL_WIDTH - PADDING * 2);
  const totalHeight = data.length * rowHeight + PADDING * 2;
  const fmt = format ?? ((v: number) => v.toFixed(valuePrecision));

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={totalHeight}
      viewBox={`0 0 ${width} ${totalHeight}`}
    >
      {data.map((d, i) => {
        const y = PADDING + i * rowHeight;
        const barWidth = (d.value / max) * innerWidth;
        return (
          <g key={`${d.label}-${i}`}>
            <text
              x={PADDING}
              y={y + rowHeight / 2}
              alignmentBaseline="middle"
              fontSize={12}
              fill="currentColor"
            >
              {d.label}
            </text>
            <rect
              x={LABEL_COL_WIDTH}
              y={y + 4}
              width={Math.max(2, barWidth)}
              height={rowHeight - 8}
              rx={3}
              fill="#0d6efd"
            />
            <text
              x={LABEL_COL_WIDTH + barWidth + 6}
              y={y + rowHeight / 2}
              alignmentBaseline="middle"
              fontSize={12}
              fill="currentColor"
            >
              {fmt(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default BarChart;
