/**
 * Skill gap analysis (F12).
 *
 * For a department in a given date window, computes:
 *   - demand: how many distinct shifts require each skill
 *   - supply: how many active users in the department have each skill
 *   - gap:    max(0, demand - supply) — a non-negative integer; negative
 *             values would mean "we have spare coverage", which is interesting
 *             but stored as gap=0 so the UI can sort by "where we're short".
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';

export interface SkillGapEntry {
  skillId: number;
  skillName: string;
  demand: number;
  supply: number;
  gap: number;
}

export interface SkillGapReport {
  departmentId: number;
  rangeStart: string;
  rangeEnd: string;
  entries: SkillGapEntry[];
}

export class SkillGapService {
  constructor(private pool: Pool) {}

  /**
   * @param departmentId Target department.
   * @param rangeStart   Inclusive start (YYYY-MM-DD).
   * @param rangeEnd     Inclusive end (YYYY-MM-DD).
   */
  async analyze(
    departmentId: number,
    rangeStart: string,
    rangeEnd: string
  ): Promise<SkillGapReport> {
    // Demand: distinct shifts requiring each skill in the window.
    // We union shift_skills (per-shift overrides) with the originating
    // template's required skills so a shift inherits skills the template
    // declared but the shift didn't override.
    const [demandRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sk.id AS skill_id, sk.name AS skill_name,
              COUNT(DISTINCT shift_skill_pair.shift_id) AS demand
         FROM (
            SELECT s.id AS shift_id, ss.skill_id
              FROM shifts s
              JOIN shift_skills ss ON s.id = ss.shift_id
             WHERE s.department_id = ?
               AND s.date BETWEEN ? AND ?
            UNION
            SELECT s.id AS shift_id, sts.skill_id
              FROM shifts s
              JOIN shift_template_skills sts ON s.template_id = sts.template_id
             WHERE s.department_id = ?
               AND s.date BETWEEN ? AND ?
         ) AS shift_skill_pair
         JOIN skills sk ON sk.id = shift_skill_pair.skill_id
        GROUP BY sk.id, sk.name`,
      [departmentId, rangeStart, rangeEnd, departmentId, rangeStart, rangeEnd]
    );

    // Supply: active users belonging to the department who have each skill.
    const [supplyRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sk.id AS skill_id, sk.name AS skill_name,
              COUNT(DISTINCT u.id) AS supply
         FROM users u
         JOIN user_departments ud ON u.id = ud.user_id
         JOIN user_skills us ON u.id = us.user_id
         JOIN skills sk ON us.skill_id = sk.id
        WHERE ud.department_id = ?
          AND u.is_active = 1
        GROUP BY sk.id, sk.name`,
      [departmentId]
    );

    const supplyByName = new Map<string, { id: number; supply: number }>();
    for (const row of supplyRows) {
      supplyByName.set(row.skill_name as string, {
        id: row.skill_id as number,
        supply: row.supply as number,
      });
    }

    const entries: SkillGapEntry[] = [];
    const seen = new Set<string>();
    for (const row of demandRows) {
      const name = row.skill_name as string;
      const demand = row.demand as number;
      const supply = supplyByName.get(name)?.supply ?? 0;
      seen.add(name);
      entries.push({
        skillId: row.skill_id as number,
        skillName: name,
        demand,
        supply,
        gap: Math.max(0, demand - supply),
      });
    }
    // Add skills that have supply but no demand (gap = 0). Useful context.
    for (const [name, info] of supplyByName.entries()) {
      if (seen.has(name)) continue;
      entries.push({ skillId: info.id, skillName: name, demand: 0, supply: info.supply, gap: 0 });
    }

    // Sort: largest gap first, then by skill name.
    entries.sort((a, b) => (b.gap - a.gap) || a.skillName.localeCompare(b.skillName));

    return { departmentId, rangeStart, rangeEnd, entries };
  }
}
