/**
 * ShiftSwapOfferService — open shift board unit tests.
 *
 * Covers posting an assignment as an open offer, listing/scoping the board,
 * cancelling an offer, and claiming one (which produces a real shift-swap
 * request through the same approval machinery the targeted flow uses).
 */

import { ShiftSwapService } from '../services/ShiftSwapService';
import { ShiftSwapOfferService } from '../services/ShiftSwapOfferService';

type Tuple = [unknown, unknown];

const assignmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 100,
  user_id: 7,
  status: 'confirmed',
  date: '2099-01-01',
  ...overrides,
});

const offerRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  assignment_id: 100,
  user_id: 7,
  notes: null,
  status: 'open',
  claimed_by_swap_request_id: null,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const swapRow = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  requester_user_id: 7,
  requester_assignment_id: 100,
  target_user_id: 9,
  target_assignment_id: 200,
  status: 'pending',
  declined_by: null,
  notes: null,
  reviewer_id: null,
  reviewed_at: null,
  review_notes: null,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const workflow = {
  id: 10,
  changeType: 'ShiftSwap.Request',
  requireAll: false,
  description: null,
  steps: [{ id: 20, workflowId: 10, stepOrder: 1, approverScope: 'unit_structure' }],
};

const makePool = () => {
  const execute = jest.fn().mockResolvedValue([[], null]);
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  const getConnection = jest.fn().mockResolvedValue(conn);
  return { pool: { execute, getConnection } as never, execute, conn };
};

/** Builds a `ShiftSwapOfferService` wired to a real `ShiftSwapService` over the same pool. */
const makeOfferService = (pool: unknown) => new ShiftSwapOfferService(pool as never, new ShiftSwapService(pool as never));

describe('ShiftSwapOfferService.createOpenOffer', () => {
  it('throws when the assignment does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.createOpenOffer(7, 100)).rejects.toThrow('Assignment not found');
  });

  it('refuses an assignment the caller does not own', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[assignmentRow({ user_id: 99 })], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.createOpenOffer(7, 100)).rejects.toThrow('You can only offer your own assignment');
  });

  it('refuses an assignment that is not pending or confirmed', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[assignmentRow({ status: 'cancelled' })], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.createOpenOffer(7, 100)).rejects.toThrow(/Cannot offer an assignment in status/);
  });

  it('refuses a shift that has already passed', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow({ date: '2020-01-01' })], null] as Tuple)
      .mockResolvedValueOnce([[{ today: '2099-06-01' }], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.createOpenOffer(7, 100)).rejects.toThrow('Cannot offer a shift that has already passed');
  });

  it('refuses a second concurrent open offer on the same assignment', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow()], null] as Tuple)
      .mockResolvedValueOnce([[{ today: '2020-01-01' }], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 5 }], null] as Tuple); // an open offer already exists
    const svc = makeOfferService(pool);
    await expect(svc.createOpenOffer(7, 100)).rejects.toThrow('already posted as an open offer');
  });

  it('creates the offer and audits it', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow()], null] as Tuple)
      .mockResolvedValueOnce([[{ today: '2020-01-01' }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple) // no existing open offer
      .mockResolvedValueOnce([{ insertId: 9 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[offerRow({ id: 9 })], null] as Tuple); // getOpenOfferById
    const svc = makeOfferService(pool);
    const created = await svc.createOpenOffer(7, 100, 'flexible on timing');
    expect(created.id).toBe(9);
    expect(created.status).toBe('open');
  });

  it('throws when getOpenOfferById cannot find the row just inserted', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow()], null] as Tuple)
      .mockResolvedValueOnce([[{ today: '2020-01-01' }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([{ insertId: 9 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple); // getOpenOfferById -> null
    const svc = makeOfferService(pool);
    await expect(svc.createOpenOffer(7, 100)).rejects.toThrow('Failed to retrieve created open offer');
  });
});

describe('ShiftSwapOfferService.listOpenOffers', () => {
  it('returns an empty list without querying when the caller has no visible org units', async () => {
    const { pool, execute } = makePool();
    const svc = makeOfferService(pool);
    const offers = await svc.listOpenOffers(7, []);
    expect(offers).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller org units and excludes their own offers', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{
        ...offerRow({ id: 2, user_id: 9 }),
        user_name: 'Jane Doe',
        shift_id: 55,
        date: '2099-01-02',
        start_time: '08:00',
        end_time: '16:00',
        department_name: 'ICU',
      }],
      null,
    ] as Tuple);
    const svc = makeOfferService(pool);
    const offers = await svc.listOpenOffers(7, [1, 2]);
    expect(offers).toHaveLength(1);
    expect(offers[0].userName).toBe('Jane Doe');
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/o\.user_id != \?/);
    expect(sql).toMatch(/org_unit_id IN \(1,2\)/);
    expect(params).toEqual([7]);
  });

  it('restricts to the caller own offers when mine is true', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = makeOfferService(pool);
    await svc.listOpenOffers(7, [], true);
    const [sql] = execute.mock.calls[0];
    expect(sql).toMatch(/o\.user_id = \?/);
  });

  it('does not scope by org unit when unrestricted', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = makeOfferService(pool);
    await svc.listOpenOffers(7, null);
    const [sql] = execute.mock.calls[0];
    expect(sql).toMatch(/o\.user_id != \?/);
    expect(sql).not.toMatch(/org_unit_id/);
  });
});

describe('ShiftSwapOfferService.cancelOpenOffer', () => {
  it('cancels successfully', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[offerRow({ status: 'cancelled' })], null] as Tuple);
    const svc = makeOfferService(pool);
    const cancelled = await svc.cancelOpenOffer(1, 7);
    expect(cancelled.status).toBe('cancelled');
  });

  it('throws NotFound when the offer does not exist', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.cancelOpenOffer(1, 7)).rejects.toThrow('Open shift offer not found');
  });

  it('throws Forbidden when the caller does not own the offer', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[offerRow({ user_id: 99 })], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.cancelOpenOffer(1, 7)).rejects.toThrow('Forbidden');
  });

  it('throws Conflict when the offer is not open', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[offerRow({ status: 'claimed' })], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.cancelOpenOffer(1, 7)).rejects.toThrow(/Cannot cancel offer in status/);
  });
});

describe('ShiftSwapOfferService.claimOpenOffer', () => {
  const internalsOf = (service: ShiftSwapOfferService) =>
    service as unknown as {
      workflows: { getWorkflowByChangeType: (t: string) => unknown };
      resolution: {
        resolvePrimaryOrgUnitForUser: (u: number) => unknown;
        canCreatePendingApprovalForStep: (s: unknown, c: unknown) => unknown;
      };
      decisions: {
        createPendingApprovalForStep: (w: number, s: unknown, l: unknown, c: unknown) => unknown;
      };
    };

  const spyWorkflowResolution = (service: ShiftSwapOfferService, canCreate = true) => {
    const internals = internalsOf(service);
    jest.spyOn(internals.workflows, 'getWorkflowByChangeType').mockResolvedValue(workflow as never);
    jest.spyOn(internals.resolution, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(internals.resolution, 'canCreatePendingApprovalForStep').mockResolvedValue(canCreate as never);
    return internals;
  };

  it('throws when the offer does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow('Open shift offer not found');
  });

  it('throws when the offer is not open', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[offerRow({ status: 'claimed' })], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow(/Cannot claim offer in status/);
  });

  it('refuses a caller claiming their own offer', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[offerRow({ user_id: 9 })], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow('cannot claim your own open offer');
  });

  it('throws when the claimer assignment does not exist', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[offerRow()], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow('Claimer assignment not found');
  });

  it('throws when the claimer does not own the offered assignment', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[offerRow()], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 200, user_id: 999 }], null] as Tuple);
    const svc = makeOfferService(pool);
    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow('Claimer does not own the offered assignment');
  });

  it('refuses upfront when no approver can be resolved for the offer owner', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[offerRow()], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 200, user_id: 9 }], null] as Tuple);
    const svc = makeOfferService(pool);
    spyWorkflowResolution(svc, false);
    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow(/No approver could be resolved/);
  });

  it('diagnoses a concurrent claim on the same offer', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[offerRow()], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 200, user_id: 9 }], null] as Tuple);
    conn.execute.mockResolvedValueOnce([[{ status: 'claimed' }], null]); // locked re-check
    const svc = makeOfferService(pool);
    spyWorkflowResolution(svc);
    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow(/Cannot claim offer in status/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('rolls the claim back when approver resolution changes mid-flight', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[offerRow()], null] as Tuple) // getOpenOfferById
      .mockResolvedValueOnce([[{ id: 200, user_id: 9 }], null] as Tuple); // claimer assignment
    conn.execute
      .mockResolvedValueOnce([[{ status: 'open' }], null]) // locked re-check
      .mockResolvedValueOnce([{ insertId: 501 }, null]) // INSERT shift_swap_requests
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE offer -> claimed
    execute.mockResolvedValue([[swapRow()], null] as Tuple); // getById + cleanup UPDATEs fall through
    const svc = makeOfferService(pool);
    const internals = spyWorkflowResolution(svc);
    jest.spyOn(internals.decisions, 'createPendingApprovalForStep').mockResolvedValue(null as never);

    await expect(svc.claimOpenOffer(1, 9, 200)).rejects.toThrow(/approver resolution changed/);

    const revertOffer = execute.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE shift_swap_offers SET status = 'open'")
    );
    expect(revertOffer).toBeDefined();
  });

  it('claims the offer end to end', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[offerRow()], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 200, user_id: 9 }], null] as Tuple);
    conn.execute
      .mockResolvedValueOnce([[{ status: 'open' }], null])
      .mockResolvedValueOnce([{ insertId: 501 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValue([[swapRow()], null] as Tuple);
    const svc = makeOfferService(pool);
    const internals = spyWorkflowResolution(svc);
    jest.spyOn(internals.decisions, 'createPendingApprovalForStep').mockResolvedValue({ id: 900 } as never);

    const created = await svc.claimOpenOffer(1, 9, 200, 'happy to take this one');
    expect(created.id).toBe(501);
    expect(created.status).toBe('pending');
    expect(conn.commit).toHaveBeenCalled();
  });
});
