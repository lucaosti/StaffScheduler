/**
 * StatsBadge — Small summary of shifts and employees counts.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface Props {
  shiftCount: number;
  employeeCount: number;
}

const StatsBadge: React.FC<Props> = ({ shiftCount, employeeCount }) => (
  <div className="text-muted">
    {shiftCount} shift{shiftCount !== 1 ? 's' : ''} · {employeeCount} employees
  </div>
);

export default StatsBadge;
