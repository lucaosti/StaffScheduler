/**
 * The mobile build's API-URL precondition, exercised as a pure function.
 *
 * @author Luca Ostinelli
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apiUrlProblem } from './check-api-url.mjs';

test('an absolute https URL is accepted', () => {
  assert.equal(apiUrlProblem('https://api.example.com/api/v1'), null);
});

test('a plain-http URL is refused, even for a development backend on the LAN', () => {
  // The Android WebView serves the app from https://localhost with no
  // cleartext or mixed-content allowance, so an http API is blocked at runtime.
  assert.match(apiUrlProblem('http://192.168.1.20:3001/api/v1'), /https/);
});

test('an unset or blank value is refused', () => {
  assert.match(apiUrlProblem(undefined), /not set/);
  assert.match(apiUrlProblem(''), /not set/);
  assert.match(apiUrlProblem('   '), /not set/);
});

test('the relative web default is refused', () => {
  // The value the web build ships with: inside the WebView it would resolve
  // against the app's own asset server instead of the backend.
  assert.match(apiUrlProblem('/api/v1'), /absolute https/);
});

test('a URL with a non-HTTPS scheme is refused', () => {
  assert.match(apiUrlProblem('capacitor://localhost/api/v1'), /absolute https/);
  assert.match(apiUrlProblem('ftp://api.example.com'), /absolute https/);
});
