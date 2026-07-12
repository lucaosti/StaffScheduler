/**
 * Single "mega log" for a simulation run: every action of every simulated
 * actor (employee thread, manager thread) is appended here as one readable
 * line, plus a final summary. No structured-logging framework — this file
 * is meant to be read top to bottom by a human.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';

export class MegaLog {
  private stream: fs.WriteStream;
  private startedAt: number;
  private counters: Record<string, number> = {};

  constructor(public readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { flags: 'w' });
    this.startedAt = performanceNow();
  }

  private write(line: string): void {
    this.stream.write(line + '\n');
  }

  private elapsedMs(): string {
    return `${(performanceNow() - this.startedAt).toFixed(0)}ms`;
  }

  /** A section banner, to make the log skimmable. */
  section(title: string): void {
    const line = `\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`;
    console.log(line);
    this.write(line);
  }

  /** One log line for a specific actor's action. */
  actor(kind: 'EMPLOYEE' | 'MANAGER', actorId: number, message: string): void {
    const line = `[${this.elapsedMs().padStart(8)}] [${kind}#${actorId}] ${message}`;
    this.write(line);
  }

  /** A verification result line — always explicit PASS/FAIL, never silent. */
  verify(ok: boolean, subject: string, detail: string): void {
    const tag = ok ? 'PASS' : 'FAIL';
    this.count(ok ? 'verify.pass' : 'verify.fail');
    const line = `[${this.elapsedMs().padStart(8)}] [VERIFY:${tag}] ${subject} — ${detail}`;
    if (!ok) console.log(line);
    this.write(line);
  }

  /** Plain info line, not tied to a specific actor. */
  info(message: string): void {
    const line = `[${this.elapsedMs().padStart(8)}] [INFO] ${message}`;
    console.log(line);
    this.write(line);
  }

  count(key: string, by = 1): void {
    this.counters[key] = (this.counters[key] ?? 0) + by;
  }

  getCounters(): Readonly<Record<string, number>> {
    return this.counters;
  }

  summary(extra: string[] = []): void {
    const lines = [
      '',
      '='.repeat(78),
      'SUMMARY',
      '='.repeat(78),
      ...Object.entries(this.counters)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `  ${k.padEnd(32)} ${v}`),
      ...extra,
      `  ${'total wall-clock'.padEnd(32)} ${this.elapsedMs()}`,
    ];
    console.log(lines.join('\n'));
    this.write(lines.join('\n'));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}

// Date.now()/performance.now() are both fine here — this is a plain Node
// script, not a Workflow script under replay constraints.
function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
