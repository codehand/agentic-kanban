#!/usr/bin/env node
/**
 * test-mint-token.mjs — API smoke test for POST /api/tokens (TASK-024).
 *
 * Usage:
 *   node scripts/test-mint-token.mjs <base-url> <human-token>
 *
 * Example:
 *   node scripts/test-mint-token.mjs http://127.0.0.1:3000 $ADMIN_TOKEN
 *
 * Exits 0 on all checks passing; non-zero otherwise.
 */

const [,, baseUrl, humanToken] = process.argv;
if (!baseUrl || !humanToken) {
  console.error('Usage: node scripts/test-mint-token.mjs <base-url> <human-token>');
  process.exit(2);
}

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  ok   - ${name}`);
  else { failures.push(name); console.error(`  FAIL - ${name}${detail ? ': ' + detail : ''}`); }
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

(async () => {
  // 1. Mint with human token
  const mintRes = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${humanToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'judge', label: 'script-judge', project: null }),
  });
  check('mint returns 200', mintRes.status === 200, `got ${mintRes.status}`);
  const minted = await json(mintRes);
  check('mint body has id', typeof minted.id === 'string' && minted.id.startsWith('tk_'));
  check('mint body has role', minted.role === 'judge');
  check('mint body has secret (shown-once)', typeof minted.secret === 'string' && minted.secret.length > 0);
  const mintedSecret = minted.secret;

  // 2. GET /api/tokens must NOT leak the secret
  const listRes = await fetch(`${baseUrl}/api/tokens`, {
    headers: { 'Authorization': `Bearer ${humanToken}` },
  });
  check('list returns 200', listRes.status === 200);
  const listText = await listRes.text();
  check('list does NOT contain secret', mintedSecret && !listText.includes(mintedSecret));
  const list = JSON.parse(listText);
  const hasSecretField = (list.tokens || []).some((t) => Object.prototype.hasOwnProperty.call(t, 'secret'));
  check('list tokens have no secret field', !hasSecretField);

  // 3. 401 without Authorization
  const noAuth = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'judge', label: 'no-auth' }),
  });
  check('missing auth -> 401', noAuth.status === 401, `got ${noAuth.status}`);

  // 4. 400 for invalid role
  const badRole = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${humanToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'wizard', label: 'bad' }),
  });
  check('invalid role -> 400', badRole.status === 400, `got ${badRole.status}`);

  // 5. 403 for non-human (mint a fresh implementer and try)
  //    To keep the script self-contained, we re-use the minted judge secret if
  //    we got one; judge is non-human so it should be 403.
  if (mintedSecret) {
    const nonHuman = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mintedSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'runner', label: 'should-fail' }),
    });
    check('non-human -> 403', nonHuman.status === 403, `got ${nonHuman.status}`);
  }

  console.log();
  if (failures.length === 0) {
    console.log('ALL CHECKS PASS');
    process.exit(0);
  } else {
    console.error(`FAILED: ${failures.length} check(s): ${failures.join(', ')}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('script error:', err);
  process.exit(1);
});
