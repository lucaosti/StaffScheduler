/**
 * StatsBadge — Small summary of shifts and employees counts.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  shiftCount: number;
  employeeCount: number;
}

const StatsBadge: React.FC<Props> = ({ shiftCount, employeeCount }) => {
  const { t } = useTranslation();
  // Built as one `t()` call (the "·" separator lives inside the
  // interpolated translation string) rather than two adjacent JSX
  // expressions with a literal "·" between them, so the middle dot is
  // never a raw JSX text node the i18next lint rule would flag.
  const summary = t('schedule.stats.summary', {
    shiftText: t('schedule.stats.shiftCount', { count: shiftCount }),
    employeeText: t('schedule.stats.employeeCount', { count: employeeCount }),
  });
  return <div className="text-muted">{summary}</div>;
};

export default StatsBadge;
