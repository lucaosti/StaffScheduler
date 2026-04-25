/**
 * SkillGapService tests (F12).
 */

import { SkillGapService } from '../services/SkillGapService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('SkillGapService.analyze', () => {
  it('combines demand and supply, defaults supply to 0 for unmet skills, sorts by gap desc', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          { skill_id: 1, skill_name: 'Triage', demand: 10 },
          { skill_id: 2, skill_name: 'Surgery Assist', demand: 6 },
          { skill_id: 3, skill_name: 'Pharmacology', demand: 4 },
        ],
        null,
      ])
      .mockResolvedValueOnce([
        [
          { skill_id: 1, skill_name: 'Triage', supply: 4 },
          { skill_id: 2, skill_name: 'Surgery Assist', supply: 8 },
          { skill_id: 4, skill_name: 'Cardiac Care', supply: 3 },
        ],
        null,
      ]);

    const service = new SkillGapService(pool);
    const report = await service.analyze(1, '2026-05-01', '2026-05-31');

    expect(report.entries).toEqual([
      { skillId: 1, skillName: 'Triage', demand: 10, supply: 4, gap: 6 },
      { skillId: 3, skillName: 'Pharmacology', demand: 4, supply: 0, gap: 4 },
      { skillId: 4, skillName: 'Cardiac Care', demand: 0, supply: 3, gap: 0 },
      { skillId: 2, skillName: 'Surgery Assist', demand: 6, supply: 8, gap: 0 },
    ]);
  });

  it('passes the date window to both queries', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]).mockResolvedValueOnce([[], null]);
    const service = new SkillGapService(pool);
    await service.analyze(7, '2026-04-01', '2026-04-30');
    expect(execute.mock.calls[0][1]).toEqual([7, '2026-04-01', '2026-04-30', 7, '2026-04-01', '2026-04-30']);
    expect(execute.mock.calls[1][1]).toEqual([7]);
  });
});
