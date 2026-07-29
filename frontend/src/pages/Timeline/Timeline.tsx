/**
 * Timeline — a Gantt view of who is working when.
 *
 * WHY THE BARS ARE POSITIONED WITH PERCENTAGES AND NOT A CHART LIBRARY. Every
 * bar is a fraction of the visible range, and a range is two numbers, so the
 * arithmetic is one subtraction and one division. A charting dependency would
 * bring an axis model, a scale abstraction and a rendering layer to do that,
 * and would have to be taught the one thing that actually matters here — that
 * a bar crossing midnight is a single interval — which the server has already
 * resolved into absolute instants.
 *
 * WHAT IS DELIBERATELY ABSENT. No pay, no absence reasons, no assignment
 * notes: the server does not send them and this view has nowhere to put them.
 * That is the whole visibility decision, and it lives in the projection rather
 * than in what the component chooses to render — a client that renders less
 * than it received is not a boundary.
 *
 * @author Luca Ostinelli
 */

import React, { useMemo, useState } from 'react';
import QueryState from '../../components/QueryState';
import { useTimelineQuery, useTimelineSourcesQuery } from '../../hooks/useTimeline';
import type { TimelineBar } from '../../services/timelineService';
import { todayIso } from '../../utils/format';


/** Colour per source, so a shift and an on-call period are distinguishable. */
const SOURCE_CLASS: Record<string, string> = {
  shifts: 'bg-primary',
  'on-call': 'bg-warning',
};

const SOURCE_LABEL: Record<string, string> = {
  shifts: 'Shifts',
  'on-call': 'On call',
};

const Timeline: React.FC = () => {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso(6));
  const [source, setSource] = useState('');

  const sources = useTimelineSourcesQuery();
  const timeline = useTimelineQuery(from, to, source || undefined);

  // The window in absolute terms, so a bar's position is its offset into it.
  // `to` is inclusive as a DATE, so the window ends at the END of that day —
  // otherwise every bar on the last day would fall outside the chart.
  const windowStart = useMemo(() => Date.parse(`${from}T00:00:00Z`), [from]);
  const windowEnd = useMemo(() => Date.parse(`${to}T00:00:00Z`) + 86_400_000, [to]);

  const barsByLane = useMemo(() => {
    const grouped = new Map<string, TimelineBar[]>();
    for (const bar of timeline.data?.bars ?? []) {
      grouped.set(bar.laneId, [...(grouped.get(bar.laneId) ?? []), bar]);
    }
    return grouped;
  }, [timeline.data]);

  const geometry = (bar: TimelineBar) => {
    const span = windowEnd - windowStart;
    const start = Math.max(Date.parse(bar.start), windowStart);
    const end = Math.min(Date.parse(bar.end), windowEnd);
    return {
      left: `${((start - windowStart) / span) * 100}%`,
      // A floor of a fraction of a percent, so a short bar in a long window is
      // still visible rather than rendering as nothing at all.
      width: `${Math.max(((end - start) / span) * 100, 0.4)}%`,
    };
  };

  const days = useMemo(() => {
    const out: string[] = [];
    for (let t = windowStart; t < windowEnd; t += 86_400_000) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }, [windowStart, windowEnd]);

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-3">Timeline</h1>

      <div className="row g-2 align-items-end mb-3">
        <div className="col-auto">
          <label className="form-label" htmlFor="timeline-from">From</label>
          <input
            id="timeline-from"
            type="date"
            className="form-control"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="col-auto">
          <label className="form-label" htmlFor="timeline-to">To</label>
          <input
            id="timeline-to"
            type="date"
            className="form-control"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="col-auto">
          <label className="form-label" htmlFor="timeline-source">Source</label>
          <select
            id="timeline-source"
            className="form-select"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All sources</option>
            {(sources.data ?? []).map((key) => (
              <option key={key} value={key}>{SOURCE_LABEL[key] ?? key}</option>
            ))}
          </select>
        </div>
      </div>

      <QueryState
        isLoading={timeline.isLoading}
        isError={timeline.isError}
        error={timeline.error}
        onRetry={timeline.refetch}
        isEmpty={(timeline.data?.lanes.length ?? 0) === 0}
        loadingMessage="Loading timeline…"
        empty={<p className="text-muted">Nothing scheduled in this range.</p>}
      >
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th style={{ width: '18%' }}>Person</th>
                <th>
                  <div className="d-flex justify-content-between small text-muted">
                    {days.map((day) => (
                      <span key={day}>{day.slice(5)}</span>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {(timeline.data?.lanes ?? []).map((lane) => (
                <tr key={lane.id}>
                  <td>{lane.label}</td>
                  <td>
                    <div className="position-relative" style={{ height: 24 }}>
                      {(barsByLane.get(lane.id) ?? []).map((bar, i) => (
                        <div
                          key={`${bar.source}-${bar.start}-${i}`}
                          className={`position-absolute rounded ${SOURCE_CLASS[bar.source] ?? 'bg-secondary'}`}
                          style={{ ...geometry(bar), top: 2, height: 20 }}
                          title={`${bar.label} — ${new Date(bar.start).toLocaleString()} to ${new Date(bar.end).toLocaleString()}`}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="d-flex gap-3 small text-muted">
          {(timeline.data?.sources ?? []).map((key) => (
            <span key={key}>
              <span
                className={`d-inline-block rounded me-1 ${SOURCE_CLASS[key] ?? 'bg-secondary'}`}
                style={{ width: 12, height: 12 }}
              />
              {SOURCE_LABEL[key] ?? key}
            </span>
          ))}
        </div>
      </QueryState>
    </div>
  );
};

export default Timeline;
