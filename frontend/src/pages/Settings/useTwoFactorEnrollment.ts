/**
 * useTwoFactorEnrollment — the enroll/disable state machine for
 * TwoFactorSection: which method (if any) is being enrolled or disabled,
 * the current step of that flow, and the mutating calls themselves.
 *
 * Only one method can be enrolling or disabling at a time — `enrolling` and
 * `disabling` are each a single `TwoFactorMethodType | null` rather than a
 * per-method flag, so starting a second flow replaces the first rather than
 * running both at once.
 *
 * @author Luca Ostinelli
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import { twoFactorMethodsKey } from '../../hooks/useTwoFactorMethods';
import {
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  requestTwoFactorChallenge,
  TwoFactorMethodType,
  TwoFactorSetup,
} from '../../services/twoFactorService';
import { runWebAuthnAuthentication, runWebAuthnRegistration } from '../../services/webAuthnClient';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

export type EnrollmentStep =
  | { phase: 'idle' }
  | { phase: 'setup'; data: TwoFactorSetup }
  | { phase: 'webauthn-ready'; data: TwoFactorSetup };

export function useTwoFactorEnrollment() {
  const { refreshUser } = useAuth();
  const { message, setMessage, run: act } = useActionFeedback();
  const queryClient = useQueryClient();

  const [enrolling, setEnrolling] = useState<TwoFactorMethodType | null>(null);
  const [step, setStep] = useState<EnrollmentStep>({ phase: 'idle' });
  const [disabling, setDisabling] = useState<TwoFactorMethodType | null>(null);
  const [disableChallengeRequested, setDisableChallengeRequested] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMethods = () => queryClient.invalidateQueries({ queryKey: twoFactorMethodsKey });

  const startEnrollment = async (methodType: TwoFactorMethodType) => {
    setBusy(true);
    setEnrolling(methodType);
    setCode('');
    await act(
      beginTwoFactorSetup(methodType).then((res) => {
        const data = res.data ?? {};
        setStep(methodType === 'webauthn' ? { phase: 'webauthn-ready', data } : { phase: 'setup', data });
      })
    );
    setBusy(false);
  };

  const cancelEnrollment = () => {
    setEnrolling(null);
    setStep({ phase: 'idle' });
    setCode('');
    setMessage(null);
  };

  const confirmEnrollment = async (methodType: TwoFactorMethodType, confirmCode: string) => {
    setBusy(true);
    const ok = await act(
      enableTwoFactor(confirmCode, methodType).then((res) => {
        // Held in state rather than shown from the response and forgotten:
        // this may be the only time the server ever produces them.
        if (res.data?.recoveryCodes.length) setRecoveryCodes(res.data.recoveryCodes);
      })
    );
    if (ok) {
      setEnrolling(null);
      setStep({ phase: 'idle' });
      setCode('');
      await Promise.all([loadMethods(), refreshUser()]);
    }
    setBusy(false);
  };

  const handleTotpOrEmailSubmit = (methodType: TwoFactorMethodType) => (e: React.FormEvent) => {
    e.preventDefault();
    void confirmEnrollment(methodType, code);
  };

  const handleWebAuthnContinue = async (data: TwoFactorSetup) => {
    setBusy(true);
    const ok = await act(
      runWebAuthnRegistration(data as unknown as PublicKeyCredentialCreationOptionsJSON).then((response) =>
        confirmEnrollment('webauthn', response)
      )
    );
    if (!ok) setBusy(false);
  };

  const finishDisable = async (methodType: TwoFactorMethodType, disableCode: string) => {
    const ok = await act(disableTwoFactor(disableCode, methodType));
    if (ok) {
      setDisabling(null);
      setDisableChallengeRequested(false);
      setCode('');
      await Promise.all([loadMethods(), refreshUser()]);
    }
    return ok;
  };

  const startDisable = (methodType: TwoFactorMethodType) => {
    setDisabling(methodType);
    setDisableChallengeRequested(false);
    setCode('');
    setMessage(null);
  };

  const cancelDisable = () => {
    setDisabling(null);
    setDisableChallengeRequested(false);
    setMessage(null);
  };

  /** For email: sends a fresh disable code and reveals the input for it. */
  const requestEmailDisableChallenge = async () => {
    setBusy(true);
    const ok = await act(requestTwoFactorChallenge('email'));
    if (ok) setDisableChallengeRequested(true);
    setBusy(false);
  };

  /** For WebAuthn: the passkey assertion IS the proof, so request the challenge and run the ceremony in one action — there is no code to type. */
  const runWebAuthnDisable = async () => {
    setBusy(true);
    await act(
      requestTwoFactorChallenge('webauthn').then((res) => {
        if (!res.data) throw new Error('No WebAuthn challenge was returned');
        return runWebAuthnAuthentication(res.data as unknown as PublicKeyCredentialRequestOptionsJSON).then(
          (response) => finishDisable('webauthn', response)
        );
      })
    );
    setBusy(false);
  };

  const confirmDisable = (methodType: TwoFactorMethodType) => async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await finishDisable(methodType, code);
    setBusy(false);
  };

  return {
    message,
    setMessage,
    enrolling,
    step,
    disabling,
    disableChallengeRequested,
    setDisableChallengeRequested,
    code,
    setCode,
    recoveryCodes,
    setRecoveryCodes,
    busy,
    startEnrollment,
    cancelEnrollment,
    handleTotpOrEmailSubmit,
    handleWebAuthnContinue,
    startDisable,
    cancelDisable,
    requestEmailDisableChallenge,
    runWebAuthnDisable,
    confirmDisable,
  };
}
