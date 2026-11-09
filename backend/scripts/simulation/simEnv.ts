/**
 * Environment the in-process app is built with — imported before anything
 * that reads `src/config`, which reads the environment once at import time.
 *
 * TRUST_PROXY_HOPS=1: every actor sends its own `X-Forwarded-For` address
 * (httpClient.ts), and the app must trust one hop to see it. Without it all
 * logins share 127.0.0.1 and the per-IP login limiter (1000 per 15 minutes
 * under NODE_ENV=test) caps a run at a thousand people. Trusting the header
 * is safe here: the app listens on loopback for this process only.
 *
 * Rejected: raising or disabling the limiter for the simulation. It is part of
 * the login path under test, and a per-person address is what production
 * traffic looks like anyway.
 *
 * @author Luca Ostinelli
 */

import dotenv from 'dotenv';

dotenv.config();
process.env.TRUST_PROXY_HOPS ??= '1';
