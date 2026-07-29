/**
 * The skills catalogue: what a person can be qualified in, and what a shift
 * can require.
 *
 * WHY THIS EXISTS NOW AND NOT BEFORE. A service with these methods used to sit
 * in the tree with no router, no spec entry and no UI, alive only because its
 * own tests referenced it — and it was removed for that reason rather than
 * wired, because unwired capability reads as implementation and the product
 * had never decided it wanted this. It is back deliberately: skills are used
 * everywhere (an employee holds them, a shift requires them at a proficiency,
 * the optimizer counts how many qualified people a shift needs) and through
 * the API a skill could be ASSIGNED but never CREATED. The catalogue could
 * only be edited by direct SQL or a seed.
 *
 * WHY DELETION IS REFUSED RATHER THAN CASCADED. All three tables that
 * reference a skill do so `ON DELETE CASCADE`, so deleting one would silently
 * strip it from every employee who holds it and every shift that requires it.
 * The second half is the dangerous one: a shift that required Triage would
 * quietly stop requiring it, and the next schedule would be legal by a
 * definition nobody chose to change. Deactivation is offered instead — it
 * keeps the history, keeps existing requirements meaningful, and stops the
 * skill being used for anything new.
 *
 * A skill that nothing references can still be deleted outright: refusing that
 * too would make a typo permanent.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ConflictError, NotFoundError } from '../errors';
import { logger } from '../config/logger';

export interface Skill {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  /** How many people hold it — the cost of retiring it, made visible. */
  employeeCount: number;
  /** How many shift requirements name it. */
  shiftRequirementCount: number;
}

const mapSkill = (row: RowDataPacket): Skill => ({
  id: row.id as number,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  isActive: Boolean(row.is_active),
  employeeCount: Number(row.employee_count ?? 0),
  shiftRequirementCount: Number(row.shift_requirement_count ?? 0),
});

/**
 * Usage counts travel with every read.
 *
 * Deliberately not a separate "statistics" endpoint: the counts are what make
 * the delete/deactivate choice an informed one, and a caller who has to ask
 * for them separately will decide without them.
 */
const SELECT_SKILL = `
  SELECT s.id, s.name, s.description, s.is_active,
         (SELECT COUNT(*) FROM user_skills us WHERE us.skill_id = s.id)   AS employee_count,
         (SELECT COUNT(*) FROM shift_skills ss WHERE ss.skill_id = s.id)  AS shift_requirement_count
    FROM skills s`;

export class SkillService {
  constructor(private pool: Pool) {}

  /** The catalogue. Inactive skills are included unless excluded explicitly. */
  async list(options: { activeOnly?: boolean } = {}): Promise<Skill[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${SELECT_SKILL}${options.activeOnly ? ' WHERE s.is_active = 1' : ''} ORDER BY s.name`
    );
    return rows.map(mapSkill);
  }

  async getById(id: number): Promise<Skill> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`${SELECT_SKILL} WHERE s.id = ?`, [id]);
    if (rows.length === 0) throw new NotFoundError('Skill not found');
    return mapSkill(rows[0]);
  }

  async create(input: { name: string; description?: string | null }): Promise<Skill> {
    await this.assertNameFree(input.name);
    const [res] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO skills (name, description) VALUES (?, ?)',
      [input.name, input.description ?? null]
    );
    logger.info(`Skill created: ${input.name}`);
    return this.getById(res.insertId);
  }

  async update(
    id: number,
    patch: { name?: string; description?: string | null; isActive?: boolean }
  ): Promise<Skill> {
    const current = await this.getById(id);
    if (patch.name !== undefined && patch.name !== current.name) {
      await this.assertNameFree(patch.name);
    }
    await this.pool.execute<ResultSetHeader>(
      'UPDATE skills SET name = ?, description = ?, is_active = ? WHERE id = ?',
      [
        patch.name ?? current.name,
        // Explicit null clears the description; `??` would make it impossible
        // to unset, the same trap the contract update had to be fixed for.
        patch.description !== undefined ? patch.description : current.description,
        patch.isActive ?? current.isActive,
        id,
      ]
    );
    return this.getById(id);
  }

  /**
   * Deletes a skill nothing references.
   *
   * The foreign keys cascade, so this would otherwise strip the skill from
   * every employee holding it and every shift requiring it — the second of
   * which changes what a legal schedule is without anyone deciding to.
   */
  async remove(id: number): Promise<void> {
    const skill = await this.getById(id);
    if (skill.employeeCount > 0 || skill.shiftRequirementCount > 0) {
      throw new ConflictError(
        `Cannot delete a skill in use (${skill.employeeCount} employee(s), ` +
          `${skill.shiftRequirementCount} shift requirement(s)). Deactivate it instead: ` +
          'that keeps existing requirements meaningful and stops it being used for anything new.'
      );
    }
    await this.pool.execute<ResultSetHeader>('DELETE FROM skills WHERE id = ?', [id]);
    logger.info(`Skill deleted: ${skill.name}`);
  }

  /**
   * The name is UNIQUE in the schema, so this is a nicer error rather than a
   * safety property — a duplicate would otherwise reach the handler as an
   * unclassified 500 from `ER_DUP_ENTRY`.
   */
  private async assertNameFree(name: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM skills WHERE name = ? LIMIT 1',
      [name]
    );
    if (rows.length > 0) throw new ConflictError('A skill with this name already exists');
  }
}
