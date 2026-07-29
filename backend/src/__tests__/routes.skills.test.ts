/**
 * Skills catalogue routes.
 *
 * The permission split is the decision worth pinning: reads on
 * `employee.read`, writes on `employee.manage` — whose own catalogue
 * description already reads "staff records and their skills", so no new code
 * was invented beside an authority that already covers this.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const service = {
  list: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

jest.mock('../services/SkillService', () => ({
  SkillService: jest.fn().mockImplementation(() => service),
}));

const requiredPermissions: string[] = [];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 7 };
    next();
  },
  requirePermission: (code: string) => {
    requiredPermissions.push(code);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

const mountApp = () => {
  const { createSkillsRouter } = require('../routes/skills');
  const app = express();
  app.use(express.json());
  app.use('/api/skills', createSkillsRouter({} as never));
  return app;
};

const skill = { id: 1, name: 'Triage', isActive: true, employeeCount: 0, shiftRequirementCount: 0 };

describe('skills routes', () => {
  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset());
    requiredPermissions.length = 0;
  });

  it('gates reads on employee.read and writes on employee.manage', () => {
    mountApp();
    expect(requiredPermissions).toEqual([
      'employee.read',
      'employee.read',
      'employee.manage',
      'employee.manage',
      'employee.manage',
    ]);
  });

  it('lists the catalogue', async () => {
    service.list.mockResolvedValue([skill]);
    const res = await request(mountApp()).get('/api/skills');
    expect(res.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith({ activeOnly: undefined });
  });

  it('passes activeOnly=true through as true', async () => {
    service.list.mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/skills?activeOnly=true');
    expect(res.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith({ activeOnly: true });
  });

  it('passes activeOnly=false through as FALSE', async () => {
    service.list.mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/skills?activeOnly=false');
    expect(res.status).toBe(200);
    // `z.coerce.boolean()` parses the string "false" as TRUE, because coercion
    // follows JavaScript truthiness and a query value is always a string. The
    // parameter therefore did the exact opposite of what it says, and a test
    // that only exercised `true` passed either way.
    expect(service.list).toHaveBeenCalledWith({ activeOnly: false });
  });

  it('rejects a value that is neither, rather than guessing', async () => {
    const res = await request(mountApp()).get('/api/skills?activeOnly=yes');
    expect(res.status).toBe(400);
  });

  it('gets one skill', async () => {
    service.getById.mockResolvedValue(skill);
    const res = await request(mountApp()).get('/api/skills/1');
    expect(res.status).toBe(200);
    expect(service.getById).toHaveBeenCalledWith(1);
  });

  it('creates a skill', async () => {
    service.create.mockResolvedValue(skill);
    const res = await request(mountApp()).post('/api/skills').send({ name: 'Triage' });
    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith({ name: 'Triage' });
  });

  it('rejects a nameless skill', async () => {
    const res = await request(mountApp()).post('/api/skills').send({ description: 'x' });
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('retires a skill through the ordinary update', async () => {
    service.update.mockResolvedValue({ ...skill, isActive: false });
    const res = await request(mountApp()).put('/api/skills/1').send({ isActive: false });
    expect(res.status).toBe(200);
    // No dedicated /deactivate verb: retiring and renaming are the same kind
    // of act, and a separate verb beside DELETE would mean almost the same as
    // it.
    expect(service.update).toHaveBeenCalledWith(1, { isActive: false });
  });

  it('deletes a skill', async () => {
    service.remove.mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/skills/1');
    expect(res.status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith(1);
  });
});
