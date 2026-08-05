/**
 * DemandForecastService unit tests.
 */

import { DemandForecastService, FORECAST_LOOKBACK_WEEKS } from '../services/DemandForecastService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const input = {
  departmentId: 3,
  date: '2026-08-10', // a Monday
  startTime: '08:00',
  endTime: '16:00',
};

describe('DemandForecastService.suggestMinStaff', () => {
  it('averages distinct staffed counts across matching historical shifts and rounds up', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { shift_id: 1, staffed_count: 3 },
        { shift_id: 2, staffed_count: 4 },
        { shift_id: 3, staffed_count: 4 },
      ],
    ]);

    const service = new DemandForecastService(pool);
    const result = await service.suggestMinStaff(input);

    expect(result.basedOnOccurrences).toBe(3);
    // (3 + 4 + 4) / 3 = 3.66... -> rounds up to 4
    expect(result.suggestedMinStaff).toBe(4);
    expect(result.lookbackWeeks).toBe(FORECAST_LOOKBACK_WEEKS);
    expect(execute).toHaveBeenCalledTimes(1);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/sc\.status = 'published'/);
    expect(sql).toMatch(/DAYOFWEEK\(s\.date\) = DAYOFWEEK\(\?\)/);
    expect(sql).toContain(`INTERVAL ${FORECAST_LOOKBACK_WEEKS} WEEK`);
    expect(params).toEqual([
      input.departmentId,
      input.startTime,
      input.endTime,
      input.date,
      input.date,
      input.date,
    ]);
  });

  it('rounds a fractional average up rather than down', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { shift_id: 1, staffed_count: 2 },
        { shift_id: 2, staffed_count: 2 },
        { shift_id: 3, staffed_count: 3 },
      ],
    ]);

    const service = new DemandForecastService(pool);
    const result = await service.suggestMinStaff(input);

    // (2 + 2 + 3) / 3 = 2.33... -> rounds up to 3
    expect(result.suggestedMinStaff).toBe(3);
    expect(result.basedOnOccurrences).toBe(3);
  });

  it('falls back to the matching active template min_staff when there is no history', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[]]) // no historical shifts
      .mockResolvedValueOnce([[{ min_staff: 5 }]]); // matching template

    const service = new DemandForecastService(pool);
    const result = await service.suggestMinStaff(input);

    expect(result.basedOnOccurrences).toBe(0);
    expect(result.suggestedMinStaff).toBe(5);
    expect(execute).toHaveBeenCalledTimes(2);
    const [templateSql, templateParams] = execute.mock.calls[1];
    expect(templateSql).toMatch(/FROM shift_templates/);
    expect(templateParams).toEqual([input.departmentId, input.startTime, input.endTime]);
  });

  it('falls back to the minimum honest placeholder when there is no history and no matching template', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[]]) // no historical shifts
      .mockResolvedValueOnce([[]]); // no matching template either

    const service = new DemandForecastService(pool);
    const result = await service.suggestMinStaff(input);

    expect(result.basedOnOccurrences).toBe(0);
    expect(result.suggestedMinStaff).toBe(1);
  });

  it('falls back to the placeholder when the matching template has a non-positive min_staff', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ min_staff: 0 }]]);

    const service = new DemandForecastService(pool);
    const result = await service.suggestMinStaff(input);

    expect(result.suggestedMinStaff).toBe(1);
  });

  it('never suggests fewer than 1 even when the historical average rounds to 0', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ shift_id: 1, staffed_count: 0 }]]);

    const service = new DemandForecastService(pool);
    const result = await service.suggestMinStaff(input);

    expect(result.basedOnOccurrences).toBe(1);
    expect(result.suggestedMinStaff).toBe(1);
  });
});
