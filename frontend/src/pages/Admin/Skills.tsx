/**
 * Skills catalogue management.
 *
 * WHY THE USAGE COUNTS ARE IN THE TABLE AND NOT BEHIND A DETAIL VIEW. They are
 * what makes retiring a skill an informed decision — how many people hold it,
 * how many shifts require it — and a count someone has to click for is a count
 * they will decide without.
 *
 * WHY DELETE STAYS VISIBLE ON A SKILL IN USE. Hiding it would leave the reader
 * wondering where it went; the server refuses with the reason and the
 * alternative, and showing that answer teaches the rule once. Disabling the
 * button silently would teach nothing.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import QueryState from '../../components/QueryState';
import { useSkillsQuery, useSkillMutations } from '../../hooks/useSkills';
import type { Skill } from '../../services/skillService';

const Skills: React.FC = () => {
  const skills = useSkillsQuery();
  const { create, update, remove } = useSkillMutations();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const failureOf = (error: unknown): string =>
    error instanceof Error ? error.message : 'The request failed';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await create.mutateAsync({ name, description: description || null });
      setName('');
      setDescription('');
    } catch (error) {
      setMessage(failureOf(error));
    }
  };

  const retire = async (skill: Skill) => {
    setMessage(null);
    try {
      await update.mutateAsync({ id: skill.id, isActive: !skill.isActive });
    } catch (error) {
      setMessage(failureOf(error));
    }
  };

  const destroy = async (skill: Skill) => {
    setMessage(null);
    try {
      await remove.mutateAsync(skill.id);
    } catch (error) {
      // The server's refusal names the counts and points at deactivation;
      // relaying it verbatim is more use than a generic failure.
      setMessage(failureOf(error));
    }
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-3">Skills</h1>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <form className="row g-2 align-items-end mb-4" onSubmit={submit}>
        <div className="col-md-3">
          <label className="form-label" htmlFor="skill-name">Name</label>
          <input
            id="skill-name"
            className="form-control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="col-md-5">
          <label className="form-label" htmlFor="skill-description">Description</label>
          <input
            id="skill-description"
            className="form-control"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="col-auto">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            Add skill
          </button>
        </div>
      </form>

      <QueryState
        isLoading={skills.isLoading}
        isError={skills.isError}
        error={skills.error}
        onRetry={skills.refetch}
        isEmpty={(skills.data?.length ?? 0) === 0}
        loadingMessage="Loading skills…"
        empty={<p className="text-muted">No skills defined yet.</p>}
      >
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th className="text-end">Employees</th>
              <th className="text-end">Shift requirements</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(skills.data ?? []).map((skill) => (
              <tr key={skill.id}>
                <td>{skill.name}</td>
                <td className="text-muted">{skill.description ?? '—'}</td>
                <td className="text-end">{skill.employeeCount}</td>
                <td className="text-end">{skill.shiftRequirementCount}</td>
                <td>
                  <span className={`badge ${skill.isActive ? 'bg-success' : 'bg-secondary'}`}>
                    {skill.isActive ? 'Active' : 'Retired'}
                  </span>
                </td>
                <td className="text-end">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary me-2"
                    onClick={() => retire(skill)}
                    disabled={update.isPending}
                  >
                    {skill.isActive ? 'Retire' : 'Reactivate'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => destroy(skill)}
                    disabled={remove.isPending}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>
    </div>
  );
};

export default Skills;
