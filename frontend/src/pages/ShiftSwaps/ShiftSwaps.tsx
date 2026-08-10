/**
 * Shift swaps — proposing one, responding to one, and deciding one.
 *
 * WHY BOTH SIDES ARE SHOWN BEFORE ANYTHING IS SENT. A swap changes two
 * people's commitments at once. A screen that shows only what you are giving
 * up, or only what you are taking, is how someone agrees to a shift they did
 * not realise they were taking — and the whole reason published assignments
 * are pinned and broken commitments are notified is that a shift someone has
 * been told about is one they have arranged their life around. See
 * ProposeSwapSection.
 *
 * TWO GATES, NOT ONE (#522). A swap used to skip straight from creation to
 * manager approval — the target was never asked, and discovered the swap by
 * finding themselves working a different day. `pending_target` is the state
 * before the target has responded; only they can accept or decline it
 * (gated on identity, not a permission code — whether to agree to a swap of
 * your own shift isn't a manager privilege). Accepting moves the request to
 * `pending`, which now means "target accepted, awaiting manager" rather
 * than "request submitted"; only then do `approve`/`decline` (gated on
 * `shiftswap.approve`) become available. A target decline ends the request
 * immediately — there is nothing left for a manager to approve. See
 * SwapRequestsTable.
 *
 * THE OPEN BOARD IS A DISCOVERY LAYER, NOT A THIRD FLOW. Proposing a swap
 * above requires already knowing who to ask. Posting a shift to the board
 * instead makes it visible to anyone eligible; claiming one immediately
 * pairs it with an assignment of the claimer's own and produces the exact
 * same kind of swap request as the targeted flow — already at "awaiting
 * approval", since offering a specific assignment back is the claimer's
 * consent in one action. The requests table above is where that swap then
 * shows up; the board never displays its own separate status. See
 * OpenShiftBoard.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useMyAssignmentsQuery } from '../../hooks/useAssignments';
import { useSwapRequestsQuery, useSwapMutations } from '../../hooks/useShiftSwaps';
import type { ShiftAssignment } from '../../types';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import ProposeSwapSection from './ProposeSwapSection';
import OpenShiftBoard from './OpenShiftBoard';
import SwapRequestsTable from './SwapRequestsTable';

const ShiftSwaps: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const myId = user?.id ? Number(user.id) : null;
  const canDecide = (user?.permissions ?? []).includes('shiftswap.approve');

  const [giving, setGiving] = useState<ShiftAssignment | null>(null);

  const mine = useMyAssignmentsQuery(myId);
  const requests = useSwapRequestsQuery();
  const { propose, respond, approve, decline, cancel } = useSwapMutations();

  const swappable = (mine.data ?? []).filter(
    (a: ShiftAssignment) => a.status === 'pending' || a.status === 'confirmed'
  );

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-3">{t('shiftSwaps.title')}</h1>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <ProposeSwapSection
        swappable={swappable}
        mineQuery={mine}
        giving={giving}
        onGivingChange={setGiving}
        proposeMutation={propose}
        act={act}
      />

      <OpenShiftBoard swappable={swappable} act={act} />

      <SwapRequestsTable
        requestsQuery={requests}
        myId={myId}
        canDecide={canDecide}
        respond={respond}
        approve={approve}
        decline={decline}
        cancel={cancel}
        act={act}
      />
    </div>
  );
};

export default ShiftSwaps;
