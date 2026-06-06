/**
 * ScheduleList — List of schedule cards with generate/publish/archive actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { Schedule } from '../../types';
import EmptyState from '../../components/EmptyState';

interface Props {
  schedules: Schedule[];
  onGenerate: (schedule: Schedule) => void;
  onPublish: (id: string | number) => void;
  onArchive: (id: string | number) => void;
  onCreateNew: () => void;
}

const ScheduleList: React.FC<Props> = ({
  schedules,
  onGenerate,
  onPublish,
  onArchive,
  onCreateNew,
}) => {
  if (schedules.length === 0) {
    return (
      <EmptyState
        icon="bi-calendar3"
        title="No schedules yet"
        message="Click New Schedule to create one."
        action={{ label: 'New Schedule', onClick: onCreateNew }}
      />
    );
  }

  return (
    <div className="row">
      {schedules.map((schedule) => (
        <div key={schedule.id} className="col-md-6 col-lg-4 mb-3">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start mb-2">
                <h6 className="card-title mb-0">{schedule.name}</h6>
                <span
                  className={`badge ${
                    schedule.status === 'published'
                      ? 'bg-success'
                      : schedule.status === 'draft'
                        ? 'bg-warning text-dark'
                        : 'bg-secondary'
                  }`}
                >
                  {schedule.status}
                </span>
              </div>
              <p className="card-text mb-2">
                <small className="text-muted">
                  {`${String(schedule.startDate).slice(0, 10)} → ${String(schedule.endDate).slice(0, 10)}`}
                </small>
                {schedule.departmentName && (
                  <>
                    <br />
                    <span className="badge bg-primary">{schedule.departmentName}</span>
                  </>
                )}
              </p>
              <div className="d-flex flex-wrap gap-2">
                <button
                  className="btn btn-sm btn-outline-success"
                  type="button"
                  onClick={() => onGenerate(schedule)}
                >
                  <i className="bi bi-magic me-1"></i>Generate
                </button>
                {schedule.status === 'draft' && (
                  <button
                    className="btn btn-sm btn-outline-primary"
                    type="button"
                    onClick={() => onPublish(schedule.id)}
                  >
                    <i className="bi bi-cloud-upload me-1"></i>Publish
                  </button>
                )}
                {schedule.status !== 'archived' && (
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    type="button"
                    onClick={() => onArchive(schedule.id)}
                  >
                    <i className="bi bi-archive me-1"></i>Archive
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ScheduleList;
