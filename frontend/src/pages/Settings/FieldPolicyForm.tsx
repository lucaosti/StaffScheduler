/**
 * FieldPolicyForm — the rule editor for one governable field. See
 * FieldPolicySection.tsx.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { ALWAYS_REQUIRED, type Draft } from './fieldPolicyDraft';

interface Props {
  editing: Draft;
  saving: boolean;
  onChange: (draft: Draft) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
}

const FieldPolicyForm: React.FC<Props> = ({ editing, saving, onChange, onSubmit, onCancel }) => (
  <form className="border rounded p-3 mt-3" onSubmit={onSubmit}>
    <h6 className="mb-3">
      Rule for <code>{editing.fieldKey}</code>
    </h6>

    <div className="row g-3">
      <div className="col-md-4">
        <div className="form-check">
          <input
            id="policy-required"
            className="form-check-input"
            type="checkbox"
            checked={ALWAYS_REQUIRED.has(editing.fieldKey) || editing.isRequired}
            disabled={ALWAYS_REQUIRED.has(editing.fieldKey)}
            onChange={(e) => onChange({ ...editing, isRequired: e.target.checked })}
          />
          <label className="form-check-label" htmlFor="policy-required">
            Required
          </label>
        </div>
        {ALWAYS_REQUIRED.has(editing.fieldKey) && (
          <div className="form-text">
            Always required — the database and sign-in depend on it, so this cannot be
            turned off.
          </div>
        )}
      </div>

      <div className="col-md-4">
        <label className="form-label" htmlFor="policy-edit-permission">
          Changing it needs
        </label>
        <input
          id="policy-edit-permission"
          className="form-control"
          placeholder="e.g. payroll.manage"
          value={editing.editPermission}
          onChange={(e) => onChange({ ...editing, editPermission: e.target.value })}
        />
        <div className="form-text">A permission code. Leave empty for no restriction.</div>
      </div>

      <div className="col-md-4">
        <label className="form-label" htmlFor="policy-visible-permission">
          Seeing it needs
        </label>
        <input
          id="policy-visible-permission"
          className="form-control"
          placeholder="e.g. payroll.read"
          value={editing.visiblePermission}
          onChange={(e) => onChange({ ...editing, visiblePermission: e.target.value })}
        />
      </div>

      <div className="col-md-3">
        <label className="form-label" htmlFor="policy-min-length">
          Min length
        </label>
        <input
          id="policy-min-length"
          type="number"
          min={0}
          className="form-control"
          value={editing.minLength}
          onChange={(e) => onChange({ ...editing, minLength: e.target.value })}
        />
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="policy-max-length">
          Max length
        </label>
        <input
          id="policy-max-length"
          type="number"
          min={1}
          className="form-control"
          value={editing.maxLength}
          onChange={(e) => onChange({ ...editing, maxLength: e.target.value })}
        />
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="policy-min-value">
          Min value
        </label>
        <input
          id="policy-min-value"
          type="number"
          className="form-control"
          value={editing.minValue}
          onChange={(e) => onChange({ ...editing, minValue: e.target.value })}
        />
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="policy-max-value">
          Max value
        </label>
        <input
          id="policy-max-value"
          type="number"
          className="form-control"
          value={editing.maxValue}
          onChange={(e) => onChange({ ...editing, maxValue: e.target.value })}
        />
      </div>

      <div className="col-md-6">
        <label className="form-label" htmlFor="policy-pattern">
          Pattern
        </label>
        <input
          id="policy-pattern"
          className="form-control font-monospace"
          maxLength={200}
          placeholder="^[A-Z]{2}\d{4}$"
          value={editing.pattern}
          onChange={(e) => onChange({ ...editing, pattern: e.target.value })}
        />
        <div className="form-text">
          A regular expression, at most 200 characters. Rejected on save if it does not
          compile.
        </div>
      </div>

      <div className="col-md-6">
        <label className="form-label" htmlFor="policy-allowed">
          Permitted values
        </label>
        <input
          id="policy-allowed"
          className="form-control"
          placeholder="Nurse, Doctor, Porter"
          value={editing.allowedValues}
          onChange={(e) => onChange({ ...editing, allowedValues: e.target.value })}
        />
        <div className="form-text">Comma-separated. Leave empty to allow anything.</div>
      </div>

      <div className="col-12">
        <label className="form-label" htmlFor="policy-help">
          Message shown when the rule refuses a value
        </label>
        <input
          id="policy-help"
          className="form-control"
          maxLength={255}
          placeholder="Include the area code, e.g. +39 02 …"
          value={editing.helpText}
          onChange={(e) => onChange({ ...editing, helpText: e.target.value })}
        />
        <div className="form-text">
          This is what the person filling the form reads. Left empty they get the generated
          wording, which tells them the rule but not what to do about it.
        </div>
      </div>
    </div>

    <div className="mt-3 d-flex gap-2">
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save rule'}
      </button>
      <button type="button" className="btn btn-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  </form>
);

export default FieldPolicyForm;
