// SPDX-License-Identifier: AGPL-3.0-only
/** Types for `fake-connect-operator.mjs`, for the tests that start it. */

export declare const SCENARIOS: readonly string[];

export interface FakeTls {
  key: string;
  cert: string;
}

export declare function selfSignedTls(): FakeTls;

export declare function startPostgresTlsFront(opts: { target: { host: string; port: number }; tls?: FakeTls }): Promise<{ port: number; close(): Promise<void> }>;

export interface FakeAnswer {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string | undefined;
  project?: string | undefined;
}

export interface FakeOperator {
  /** The value for ADMINIUM_SUPABASE_CONNECT_URL. */
  url: string;
  /** The certificate to trust. */
  cert: string;
  /** Every redeem body received. */
  redeems: { code?: unknown; verifier?: unknown }[];
  close(): Promise<void>;
}

export declare function startFakeOperator(opts: {
  instance: string;
  answer: FakeAnswer;
  scenario?: string;
  auto?: boolean;
  slowMs?: number;
  port?: number;
  basePath?: string;
  tls?: FakeTls;
}): Promise<FakeOperator>;
