// Empirical test: does `request.auth.time` exist in Firestore Rules?
// If it does NOT, transitionalRead() throws → evaluates to deny, and a
// legitimate just-registered user (no claims yet) would be BLOCKED.
//
// We seed a probe doc, then attempt a read as an authenticated user WITHOUT
// role/clubId claims (i.e. the exact "transitional" state). We compare the
// current firestore.rules helper (uses request.auth.time) vs an alternative
// that uses request.auth.token.auth_time.

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const PROJECT_ID = 'rules-probe';

async function main() {
  const rules = fs.readFileSync(path.join(__dirname, 'probe.rules'), 'utf8');
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [emuHost, emuPort] = host.split(':');

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: emuHost, port: Number(emuPort) },
  });

  // Seed probe docs with admin (rules bypassed).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'probe_authtime', 'd1'), { clubId: 'clubA' });
    await setDoc(doc(db, 'probe_authtime2', 'd1'), { clubId: 'clubA' });
  });

  // Authenticated user WITHOUT role/clubId claims == transitional state.
  // rules-unit-testing sets token.auth_time automatically.
  const authed = testEnv.authenticatedContext('user-no-claims', {});
  const db = authed.firestore();

  const results = {};

  // Probe 1: current firestore.rules logic (request.auth.time)
  try {
    await getDoc(doc(db, 'probe_authtime', 'd1'));
    results.currentRule_authTime = 'ALLOWED';
  } catch (e) {
    results.currentRule_authTime = 'DENIED: ' + (e.code || e.message);
  }

  // Probe 2: alternative logic (request.auth.token.auth_time)
  try {
    await getDoc(doc(db, 'probe_authtime2', 'd1'));
    results.altRule_tokenAuthTime = 'ALLOWED';
  } catch (e) {
    results.altRule_tokenAuthTime = 'DENIED: ' + (e.code || e.message);
  }

  fs.writeFileSync(
    path.join(__dirname, 'result.json'),
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results, null, 2));

  await testEnv.cleanup();
}

main().catch((e) => {
  fs.writeFileSync(
    path.join(__dirname, 'result.json'),
    JSON.stringify({ fatal: String(e && e.stack || e) }, null, 2)
  );
  console.error(e);
  process.exit(1);
});
