/**
 * Directory — who someone is, and how to reach them.
 *
 * WHY THIS IS NOT THE ACCOUNTS PAGE. `/users` answers "may this person sign
 * in, with which roles". This answers "who is this person" — the same human,
 * a different question, and in most organisations a different audience.
 *
 * WHY A FIELD'S VISIBILITY IS SHOWN NEXT TO IT. Custom fields carry
 * `isPublic`, and a field someone fills in without knowing who will read it is
 * how a private note becomes a published one. The flag is stated on every row
 * rather than hidden in an edit dialog nobody opens.
 *
 * WHY THE vCARD IS A LINK AND NOT A FETCH. The endpoint returns a file with a
 * content type. Pulling it through the typed client into a blob, only to hand
 * it back to a download, is work that achieves nothing an anchor does not — and
 * it would lose the filename the server sets.
 *
 * BULK vCARD IMPORT (#534): a preview, not a file-picker-and-a-spinner. What
 * it decides, stated rather than left implicit in the request it sends: a
 * duplicate email is SKIPPED, never updated — the existing person's data
 * might carry local edits an external card knows nothing about; a bad card
 * is skipped and reported, not a reason to abandon the other 199; and a
 * card becomes a real ACCOUNT (able to sign in), not just a directory
 * profile, which is why this is gated on `user.manage` — the same
 * permission that creates one from the Accounts page — rather than
 * something weaker. The preview step exists because a bulk write that
 * reports only a total is how someone discovers three months later that
 * forty people were never created; every row states what will happen and
 * why before the button that commits to it is even enabled.
 *
 * @author Luca Ostinelli
 */

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import { useMyProfileQuery, useProfileQuery, useDirectoryMutations } from '../../hooks/useDirectory';
import { useEmployeesQuery } from '../../hooks/useEmployees';
import { vcardUrl } from '../../services/directoryService';
import type { DirectoryProfile, VcardImportPreviewRow } from '../../services/directoryService';

const Directory: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const permissions = user?.permissions ?? [];
  const canReadOthers = permissions.includes('user.read');
  const canManage = permissions.includes('user.manage');

  const [selectedId, setSelectedId] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [fieldValue, setFieldValue] = useState('');

  const [vcfText, setVcfText] = useState<string | null>(null);
  const [vcfFileName, setVcfFileName] = useState('');
  const [preview, setPreview] = useState<VcardImportPreviewRow[] | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mine = useMyProfileQuery();
  const others = useEmployeesQuery('', '', canReadOthers);
  const selected = useProfileQuery(selectedId ? Number(selectedId) : null, canReadOthers);
  const { saveFields, removeField, previewImport, runImport } = useDirectoryMutations();

  const chooseVcfFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(null);
    runImport.reset();
    setVcfFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setVcfText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const doPreview = () =>
    act(previewImport.mutateAsync(vcfText as string).then((result) => setPreview(result.data?.rows ?? [])));

  const doImport = () => act(runImport.mutateAsync({ vcf: vcfText as string, defaultPassword: importPassword }));

  const resetImport = () => {
    setVcfText(null);
    setVcfFileName('');
    setPreview(null);
    setImportPassword('');
    runImport.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const willCreate = preview?.filter((r) => r.outcome === 'create').length ?? 0;

  const shown: DirectoryProfile | null = selectedId ? selected.data ?? null : mine.data ?? null;
  const showing = selectedId ? selected : mine;

  const addField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shown) return;
    const ok = await act(
      saveFields.mutateAsync({ id: shown.id, fields: [{ key: fieldKey, value: fieldValue }] })
    );
    if (ok) {
      setFieldKey('');
      setFieldValue('');
    }
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-1">{t('directory.title')}</h1>
      <p className="text-muted">
        {t('directory.subtitle')}
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {canReadOthers && (
        <div className="mb-3">
          <label className="form-label" htmlFor="directory-person">{t('directory.personLabel')}</label>
          <select
            id="directory-person"
            className="form-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">{t('directory.myProfile')}</option>
            {(others.data ?? []).map((e) => (
              <option key={String(e.id)} value={String(e.id)}>
                {[e.firstName, e.lastName].filter(Boolean).join(' ') || e.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <QueryState
        isLoading={showing.isLoading}
        isError={showing.isError}
        error={showing.error}
        onRetry={showing.refetch}
        isEmpty={!shown}
        loadingMessage={t('directory.loadingProfile')}
        empty={<p className="text-muted">{t('directory.noProfile')}</p>}
      >
        {shown && (
          <>
            <dl className="row">
              <dt className="col-sm-3">{t('directory.fields.name')}</dt>
              <dd className="col-sm-9">
                {shown.firstName} {shown.lastName}
              </dd>
              <dt className="col-sm-3">{t('directory.fields.email')}</dt>
              <dd className="col-sm-9">{shown.email}</dd>
              <dt className="col-sm-3">{t('directory.fields.phone')}</dt>
              <dd className="col-sm-9">{shown.phone ?? t('common.emptyValue')}</dd>
              <dt className="col-sm-3">{t('directory.fields.position')}</dt>
              <dd className="col-sm-9">{shown.position ?? t('common.emptyValue')}</dd>
              <dt className="col-sm-3">{t('directory.fields.roles')}</dt>
              <dd className="col-sm-9">{shown.roles.join(', ') || t('common.emptyValue')}</dd>
            </dl>

            <a className="btn btn-sm btn-outline-secondary mb-4" href={vcardUrl(shown.id)}>
              {t('directory.downloadVcard')}
            </a>

            <h2 className="h6">{t('directory.additionalFields')}</h2>
            {shown.fields.length === 0 ? (
              <p className="text-muted">{t('directory.noAdditionalFields')}</p>
            ) : (
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>{t('directory.columns.field')}</th>
                    <th>{t('directory.columns.value')}</th>
                    <th>{t('directory.columns.visibility')}</th>
                    {canManage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {shown.fields.map((f) => (
                    <tr key={f.key}>
                      <td>{f.key}</td>
                      <td>{f.value}</td>
                      <td>
                        {/* Stated on every row: a field filled in without
                            knowing who reads it is how a private note becomes
                            a published one. */}
                        <span className={`badge ${f.isPublic ? 'bg-info text-dark' : 'bg-secondary'}`}>
                          {f.isPublic ? t('directory.visibility.public') : t('directory.visibility.private')}
                        </span>
                      </td>
                      {canManage && (
                        <td className="text-end">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => act(removeField.mutateAsync({ id: shown.id, key: f.key }))}
                            disabled={removeField.isPending}
                          >
                            {t('memberList.remove')}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canManage && (
              <form className="row g-2 align-items-end" onSubmit={addField}>
                <div className="col-md-3">
                  <label className="form-label" htmlFor="field-key">{t('directory.columns.field')}</label>
                  <input
                    id="field-key"
                    className="form-control"
                    value={fieldKey}
                    onChange={(e) => setFieldKey(e.target.value)}
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="field-value">{t('directory.columns.value')}</label>
                  <input
                    id="field-value"
                    className="form-control"
                    value={fieldValue}
                    onChange={(e) => setFieldValue(e.target.value)}
                  />
                </div>
                <div className="col-auto">
                  <button type="submit" className="btn btn-primary" disabled={saveFields.isPending}>
                    {t('directory.form.saveField')}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </QueryState>

      {canManage && (
        <div className="mt-5 pt-4 border-top">
          <h2 className="h6">{t('directory.bulkImport.title')}</h2>
          <p className="text-muted small">
            {t('directory.bulkImport.description')}
          </p>

          {runImport.data?.data ? (
            <>
              <div className="alert alert-success">
                {t('directory.bulkImport.createdMessage', {
                  count: runImport.data.data.inserted,
                  plural: runImport.data.data.inserted === 1 ? '' : 's',
                })}
                {runImport.data.data.skipped.length > 0 && (
                  <>
                    {' '}
                    {t('directory.bulkImport.skippedMessage', {
                      count: runImport.data.data.skipped.length,
                      items: runImport.data.data.skipped
                        .map((s) => `${s.email || t('directory.bulkImport.unknownEmail')} (${s.reason})`)
                        .join(', '),
                    })}
                  </>
                )}
              </div>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={resetImport}>
                {t('directory.bulkImport.importAnother')}
              </button>
            </>
          ) : (
            <>
              <div className="mb-2">
                <label className="form-label" htmlFor="vcf-file">{t('directory.bulkImport.vcfFileLabel')}</label>
                <input
                  id="vcf-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".vcf,text/vcard"
                  className="form-control"
                  onChange={chooseVcfFile}
                />
              </div>

              {vcfText && !preview && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mb-3"
                  onClick={doPreview}
                  disabled={previewImport.isPending}
                >
                  {t('directory.bulkImport.preview', { fileName: vcfFileName })}
                </button>
              )}

              {preview && (
                <>
                  {preview.length === 0 ? (
                    <p className="text-muted">{t('directory.bulkImport.noCards')}</p>
                  ) : (
                    <table className="table table-sm align-middle">
                      <thead>
                        <tr>
                          <th>{t('directory.bulkImport.columns.name')}</th>
                          <th>{t('directory.bulkImport.columns.email')}</th>
                          <th>{t('directory.bulkImport.columns.outcome')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, i) => (
                          <tr key={`${row.email}-${i}`}>
                            <td>{row.name}</td>
                            <td>{row.email || t('common.emptyValue')}</td>
                            <td>
                              <span className={`badge ${row.outcome === 'create' ? 'bg-success' : 'bg-secondary'}`}>
                                {row.outcome === 'create'
                                  ? t('directory.bulkImport.willCreate')
                                  : t('directory.bulkImport.willSkip', { reason: row.reason })}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {willCreate > 0 && (
                    <div className="row g-2 align-items-end">
                      <div className="col-md-4">
                        <label className="form-label" htmlFor="vcf-password">
                          {t('directory.bulkImport.initialPasswordLabel')}
                        </label>
                        <input
                          id="vcf-password"
                          type="password"
                          className="form-control"
                          minLength={8}
                          value={importPassword}
                          onChange={(e) => setImportPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="col-auto">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={doImport}
                          disabled={runImport.isPending || importPassword.length < 8}
                        >
                          {t('directory.bulkImport.confirmImport', {
                            count: willCreate,
                            plural: willCreate === 1 ? '' : 's',
                          })}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Directory;
