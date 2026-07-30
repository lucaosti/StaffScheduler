/**
 * The subject context an approval is routed against: org unit, departments, roles.
 *
 * WHY THIS IS ONE FUNCTION NOW. There were two versions of it, and they
 * disagreed. `ChangeRequestService.resolveProposerContext` took
 * `ORDER BY org_unit_id ASC LIMIT 1` — the lowest membership id, whichever that
 * happens to be — while `ApprovalEngineService.resolvePrimaryOrgUnitForUser`
 * read `is_primary = 1`. For anyone belonging to exactly one unit the two agree,
 * which is why this survived; for anyone belonging to two, their change requests
 * were routed against a different org unit than their time off, and neither the
 * requester nor the approver had any way to notice. The whole point of an
 * authority panel is to say who decides your requests, and it cannot say that
 * while the answer depends on which code path asked.
 *
 * WHY `is_primary` WINS. `OrgUnitService` documents that exactly one membership
 * carries it and enforces that on write, so it is the field that means "the unit
 * this person belongs to" — the other query was reading an id whose ordering
 * carries no meaning at all.
 *
 * WHY THERE IS STILL A FALLBACK. Data predating that enforcement can have no
 * primary flagged anywhere. Returning null there would route those people's
 * requests to nobody, which is a worse failure than picking their lowest-id
 * membership — the previous behaviour, kept exactly as the fallback so this
 * change can only improve a case, never degrade one.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';

export interface SubjectContext {
  orgUnitId: number | null;
  subjectDepartmentIds: number[];
  subjectRoleIds: number[];
}

export const resolveSubjectContext = async (pool: Pool, userId: number): Promise<SubjectContext> => {
  const [orgRows] = await pool.execute<RowDataPacket[]>(
    `SELECT org_unit_id
       FROM user_org_units
      WHERE user_id = ?
      ORDER BY is_primary DESC, org_unit_id ASC
      LIMIT 1`,
    [userId]
  );
  const orgUnitId = orgRows.length > 0 ? (orgRows[0].org_unit_id as number) : null;

  const [deptRows] = await pool.execute<RowDataPacket[]>(
    `SELECT department_id FROM user_departments WHERE user_id = ?`,
    [userId]
  );

  const [roleRows] = await pool.execute<RowDataPacket[]>(
    `SELECT role_id FROM user_roles
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );

  return {
    orgUnitId,
    subjectDepartmentIds: deptRows.map((r) => r.department_id as number),
    subjectRoleIds: roleRows.map((r) => r.role_id as number),
  };
};
