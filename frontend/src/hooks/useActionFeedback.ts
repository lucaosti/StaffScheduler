/**
 * Running a mutation and showing what the server said when it refused.
 *
 * WHY THIS IS SHARED. Eight pages had written the same eight lines: clear the
 * message, await, catch, put `error.message` on screen. That is not an
 * accidental similarity — it is one decision made once and repeated, that the
 * server's refusal is the thing worth showing. Those refusals name overlapping
 * periods, conflicting assignments, skills someone lacks and roles they may
 * not grant, and they are the only place in the product where those rules are
 * explained to a person. A page that quietly replaced one with "failed" would
 * be the regression this hook exists to make hard.
 *
 * WHY IT KEEPS THE MESSAGE RATHER THAN THROWING. The caller renders it in an
 * alert next to the control that failed. A thrown error would reach the error
 * boundary and replace the page, which is the wrong response to "you cannot
 * delete this skill because three people hold it".
 *
 * @author Luca Ostinelli
 */

import { useCallback, useState } from 'react';

export function useActionFeedback() {
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async (action: Promise<unknown>): Promise<boolean> => {
    setMessage(null);
    try {
      await action;
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The request failed');
      return false;
    }
  }, []);

  return { message, setMessage, run };
}
