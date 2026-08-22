import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanOAuthCallbackUrl,
  describeOAuthCallbackFailure,
  normalizeIdentityLinkError,
  parseOAuthCallbackFailure,
} from "./auth-errors.ts";

test("explains Supabase manual-linking failures", () => {
  const result = normalizeIdentityLinkError({
    code: "manual_linking_disabled",
    message: "Manual linking is disabled",
    status: 404,
  }, "google");

  assert.match(result.message, /Allow manual linking/);
  assert.match(result.message, /Google/);
});

test("treats identities authorize 404 as manual linking disabled", () => {
  const result = normalizeIdentityLinkError({
    message: "Not Found",
    status: 404,
  }, "x");

  assert.match(result.message, /Allow manual linking/);
  assert.match(result.message, /X/);
});

test("preserves unrelated auth errors", () => {
  const source = new Error("OAuth provider is unavailable");
  assert.equal(normalizeIdentityLinkError(source, "x"), source);
});

test("explains and removes duplicated OAuth callback errors", () => {
  const url = "http://localhost:3000/?keep=1&error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user&sb=";
  const failure = parseOAuthCallbackFailure(url);
  assert.deepEqual(failure, {
    code: "identity_already_exists",
    description: "Identity is already linked to another user",
  });
  assert.match(describeOAuthCallbackFailure(failure!, "google").message, /did not merge payment ownership/);
  assert.equal(cleanOAuthCallbackUrl(url), "/?keep=1");
});
