/**
 * ApprovalStateMachine tests — the declarative transition table that makes an
 * illegal approval transition impossible by construction.
 */

export {};

import {
  nextState,
  canTransition,
  isTerminal,
  actionForDecision,
  type ApprovalState,
  type ApprovalAction,
} from '../services/ApprovalStateMachine';
import { ConflictError } from '../errors';

const TERMINAL: ApprovalState[] = ['approved', 'rejected', 'escalated'];
const ACTIONS: ApprovalAction[] = ['approve', 'reject', 'escalate'];

describe('legal transitions from pending', () => {
  it.each([
    ['approve', 'approved'],
    ['reject', 'rejected'],
    ['escalate', 'escalated'],
  ] as const)('pending --%s--> %s', (action, expected) => {
    expect(nextState('pending', action)).toBe(expected);
    expect(canTransition('pending', action)).toBe(true);
  });
});

describe('terminal states', () => {
  it.each(TERMINAL)('%s is terminal and refuses every action', (state) => {
    expect(isTerminal(state)).toBe(true);
    for (const action of ACTIONS) {
      expect(canTransition(state, action)).toBe(false);
      expect(() => nextState(state, action)).toThrow(ConflictError);
      expect(() => nextState(state, action)).toThrow(new RegExp(`Cannot ${action}.*${state}`));
    }
  });

  it('pending is not terminal', () => {
    expect(isTerminal('pending')).toBe(false);
  });
});

describe('actionForDecision', () => {
  it('maps the decision verbs to their actions', () => {
    expect(actionForDecision('approved')).toBe('approve');
    expect(actionForDecision('rejected')).toBe('reject');
  });
});
