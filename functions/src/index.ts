import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

admin.initializeApp();
const db = admin.firestore();
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '256kb' }));

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || 'sajolsarker5789@gmail.com')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
);

function hash(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function now() { return admin.firestore.FieldValue.serverTimestamp(); }
function validDate(v: any) { return !!v && new Date(v).getTime() > Date.now(); }
function licenseKey() { return `VAP-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function publicTokenPrefix(token: string) { return `${token.slice(0, 4)}••••${token.slice(-4)}`; }

async function verifyRequest(req: any) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new Error('Authentication required.');
  return admin.auth().verifyIdToken(header.slice(7));
}

async function requireUser(req: any) { return verifyRequest(req); }

async function requireAdmin(req: any) {
  const decoded = await verifyRequest(req);
  const email = String(decoded.email || '').toLowerCase();
  if (decoded.admin === true || ADMIN_EMAILS.has(email)) return decoded;
  throw new Error('Admin access required.');
}

async function loadLicense(key: string) {
  const snap = await db.collection('licenses').where('licenseKey', '==', key).limit(1).get();
  if (snap.empty) return null;
  return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
}

async function loadUserLicense(uid: string) {
  const snap = await db.collection('licenses').where('userId', '==', uid).limit(1).get();
  return snap.empty ? null : { ref: snap.docs[0].ref, data: snap.docs[0].data() };
}

async function authorizeSession(body: any) {
  const sessionToken = String(body.sessionToken || '').trim();
  const deviceId = String(body.deviceId || '').trim();
  if (!sessionToken || !deviceId) throw new Error('Activation token and device ID are required.');

  const sessionHash = hash(sessionToken);
  const deviceRef = db.collection('devices').doc(hash(deviceId).slice(0, 40));
  const deviceSnap = await deviceRef.get();
  if (!deviceSnap.exists) throw new Error('This device is not activated. Generate a new activation token from your account.');
  const device = deviceSnap.data()!;
  if (device.sessionHash !== sessionHash) throw new Error('Invalid or revoked activation token.');
  if (device.status !== 'active') throw new Error('This device is inactive.');

  const licenseRef = db.collection('licenses').doc(String(device.licenseId));
  const licenseSnap = await licenseRef.get();
  if (!licenseSnap.exists) throw new Error('License not found.');
  const license = licenseSnap.data()!;
  if (license.status !== 'active') throw new Error(`License is ${license.status}.`);
  if (!validDate(license.expiresAt)) throw new Error('License has expired.');

  await deviceRef.update({ lastSeenAt: now() });
  return { licenseRef, license, deviceRef, device };
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'visa-autofill-pro-api', version: '2.0.0' }));

// One-time bootstrap for the configured owner email. The endpoint never accepts an arbitrary email.
app.post('/admin/bootstrap', async (req, res) => {
  try {
    const decoded = await verifyRequest(req);
    const email = String(decoded.email || '').toLowerCase();
    if (!ADMIN_EMAILS.has(email)) throw new Error('This account is not configured as the owner/admin.');
    await admin.auth().setCustomUserClaims(decoded.uid, { admin: true });
    await db.collection('users').doc(decoded.uid).set({ email, role: 'admin', status: 'active', emailVerified: true, updatedAt: now() }, { merge: true });
    await db.collection('auditLogs').add({ action: 'admin.bootstrap', adminUid: decoded.uid, adminEmail: email, createdAt: now() });
    res.json({ success: true, message: 'Admin access enabled. Sign out and sign in again to refresh your token.' });
  } catch (e: any) { res.status(403).json({ success: false, message: e.message || 'Admin bootstrap failed.' }); }
});

app.post('/license/link', async (req, res) => {
  try {
    const u = await requireUser(req);
    const key = String(req.body.licenseKey || '').trim().toUpperCase();
    if (!key) throw new Error('License key is required.');
    const found = await loadLicense(key);
    if (!found) throw new Error('License not found.');
    const d = found.data;
    if (d.status !== 'active') throw new Error(`License is ${d.status}.`);
    if (d.userId && d.userId !== u.uid) throw new Error('This license is already linked to another account.');
    const existing = await loadUserLicense(u.uid);
    if (existing && existing.ref.id !== found.ref.id) throw new Error('Your account already has a license linked.');
    await found.ref.update({ userId: u.uid, userEmail: u.email || null, linkedAt: d.linkedAt || now(), updatedAt: now() });
    await db.collection('users').doc(u.uid).set({ email: u.email || '', updatedAt: now() }, { merge: true });
    res.json({ success: true, message: 'License linked successfully.' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not link license.' }); }
});

// Generate a one-time activation token. It is displayed only once and stored only as a hash.
app.post('/license/generate-token', async (req, res) => {
  try {
    const u = await requireUser(req);
    const found = await loadUserLicense(u.uid);
    if (!found) throw new Error('Link a license before generating an activation token.');
    if (found.data.status !== 'active') throw new Error(`License is ${found.data.status}.`);
    if (!validDate(found.data.expiresAt)) throw new Error('License has expired.');
    const rawToken = `vap_${randomToken(24)}`;
    const tokenRef = db.collection('activationTokens').doc(hash(rawToken));
    await tokenRef.set({ tokenHash: hash(rawToken), userId: u.uid, licenseId: found.ref.id, status: 'unused', createdAt: now(), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
    res.json({ success: true, token: rawToken, display: publicTokenPrefix(rawToken), expiresInSeconds: 900, message: 'Copy this token now. It is shown only once.' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not generate token.' }); }
});

// First extension activation: consumes the one-time token and binds the browser/device.
app.post('/license/activate-token', async (req, res) => {
  try {
    const tokenValue = String(req.body.token || '').trim();
    const deviceId = String(req.body.deviceId || '').trim();
    if (!tokenValue || !deviceId) throw new Error('Activation token and device ID are required.');
    const tokenRef = db.collection('activationTokens').doc(hash(tokenValue));
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) throw new Error('Invalid activation token.');
    const t = tokenSnap.data()!;
    if (t.status !== 'unused') throw new Error('This activation token has already been used or revoked.');
    if (!validDate(t.expiresAt)) throw new Error('This activation token has expired. Generate a new one.');

    const licenseRef = db.collection('licenses').doc(String(t.licenseId));
    const licenseSnap = await licenseRef.get();
    if (!licenseSnap.exists) throw new Error('License not found.');
    const license = licenseSnap.data()!;
    if (license.status !== 'active') throw new Error(`License is ${license.status}.`);
    if (!validDate(license.expiresAt)) throw new Error('License has expired.');

    const deviceHash = hash(deviceId);
    const deviceRef = db.collection('devices').doc(deviceHash.slice(0, 40));
    const existing = await deviceRef.get();
    if (existing.exists && existing.data()?.licenseId !== licenseRef.id) throw new Error('This device is already registered to another license.');
    if (!existing.exists) {
      const active = await db.collection('devices').where('licenseId', '==', licenseRef.id).where('status', '==', 'active').get();
      if (active.size >= Number(license.deviceLimit || 1)) throw new Error('Device limit reached. Ask the admin to increase the limit or reset devices.');
    }

    const sessionToken = `sess_${randomToken(32)}`;
    await db.runTransaction(async tx => {
      tx.update(tokenRef, { status: 'used', usedAt: now(), usedDeviceHash: deviceHash });
      tx.set(deviceRef, { userId: license.userId || null, licenseId: licenseRef.id, deviceHash, status: 'active', sessionHash: hash(sessionToken), lastSeenAt: now(), createdAt: existing.exists ? existing.data()?.createdAt : now() }, { merge: true });
    });

    res.json({ success: true, sessionToken, license: { licenseId: licenseRef.id, status: license.status, credits: Number(license.credits || 0), expiresAt: license.expiresAt || null, deviceLimit: Number(license.deviceLimit || 1) } });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Activation failed.' }); }
});

app.post('/license/verify', async (req, res) => {
  try {
    const r = await authorizeSession(req.body);
    res.json({ success: true, license: { licenseId: r.licenseRef.id, status: r.license.status, credits: Number(r.license.credits || 0), expiresAt: r.license.expiresAt || null, deviceLimit: Number(r.license.deviceLimit || 1) } });
  } catch (e: any) { res.status(401).json({ success: false, message: e.message || 'Verification failed.' }); }
});

app.post('/credits/consume', async (req, res) => {
  try {
    const r = await authorizeSession(req.body);
    const operation = String(req.body.operation || 'pdf_processing');
    const operationId = String(req.body.operationId || '').trim();
    if (!operationId) throw new Error('Operation ID is required.');
    const existing = await db.collection('creditTransactions').where('operationId', '==', operationId).limit(1).get();
    if (!existing.empty) {
      const x = existing.docs[0].data();
      return res.json({ success: true, remainingCredits: Number(x.balanceAfter || 0), cost: Math.abs(Number(x.amount || 0)), duplicate: true });
    }
    const setting = await db.collection('settings').doc('creditCosts').get();
    const cost = Number(setting.data()?.[operation] ?? 2);
    if (!Number.isFinite(cost) || cost <= 0) throw new Error('Invalid credit configuration.');
    let remaining = 0;
    await db.runTransaction(async tx => {
      const snap = await tx.get(r.licenseRef);
      const current = Number(snap.data()?.credits || 0);
      if (current < cost) throw new Error(`Insufficient credits. Required: ${cost}.`);
      remaining = current - cost;
      tx.update(r.licenseRef, { credits: remaining, updatedAt: now() });
      const tr = db.collection('creditTransactions').doc();
      tx.set(tr, { userId: snap.data()?.userId || null, licenseId: r.licenseRef.id, type: 'usage', operation, operationId, amount: -cost, balanceBefore: current, balanceAfter: remaining, createdAt: now() });
    });
    res.json({ success: true, remainingCredits: remaining, cost });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Credit operation failed.' }); }
});

app.post('/payments/create', async (req, res) => {
  try {
    const u = await requireUser(req);
    const packageId = String(req.body.packageId || '');
    if (!packageId) throw new Error('Package is required.');
    const ps = await db.collection('creditPackages').doc(packageId).get();
    if (!ps.exists || ps.data()?.active === false) throw new Error('Package is unavailable.');
    const p = ps.data()!;
    const ref = db.collection('payments').doc();
    await ref.set({ userId: u.uid, userEmail: u.email || '', packageId, packageName: p.name, credits: Number(p.credits || 0), amount: Number(p.price || 0), currency: p.currency || 'USD', status: 'pending', createdAt: now(), updatedAt: now() });
    res.json({ success: true, paymentId: ref.id, message: 'Payment request created. Credits are added after admin approval.' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not create payment request.' }); }
});

app.post('/admin/license/create', async (req, res) => {
  try {
    const adminUser = await requireAdmin(req);
    const email = String(req.body.email || '').trim().toLowerCase();
    const credits = Math.max(0, Number(req.body.credits || 0));
    const deviceLimit = Math.max(1, Number(req.body.deviceLimit || 1));
    const expiresDays = Math.max(1, Number(req.body.expiresDays || 30));
    if (!email) throw new Error('Customer email is required.');
    let userId: string | null = null;
    try { userId = (await admin.auth().getUserByEmail(email)).uid; } catch {}
    const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
    const ref = db.collection('licenses').doc();
    const key = licenseKey();
    await ref.set({ licenseKey: key, userId, userEmail: email, status: 'active', credits, deviceLimit, expiresAt, createdAt: now(), updatedAt: now() });
    if (userId) await db.collection('users').doc(userId).set({ email, updatedAt: now() }, { merge: true });
    await db.collection('auditLogs').add({ action: 'license.create', licenseId: ref.id, licenseKey: key, adminUid: adminUser.uid, adminEmail: adminUser.email || '', createdAt: now() });
    res.json({ success: true, license: { id: ref.id, licenseKey: key }, message: 'License created successfully.' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not create license.' }); }
});

app.post('/admin/license/status', async (req, res) => {
  try { await requireAdmin(req); const id = String(req.body.licenseId || ''); const status = String(req.body.status || ''); if (!['active', 'blocked', 'revoked'].includes(status)) throw new Error('Invalid license status.'); await db.collection('licenses').doc(id).update({ status, updatedAt: now() }); await db.collection('auditLogs').add({ action: 'license.status', licenseId: id, status, createdAt: now() }); res.json({ success: true, message: `License ${status}.` }); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not update license.' }); }
});

app.post('/admin/license/credits', async (req, res) => {
  try { await requireAdmin(req); const id = String(req.body.licenseId || ''); const amount = Number(req.body.amount || 0); const reason = String(req.body.reason || 'Manual adjustment'); if (!id || !Number.isFinite(amount) || amount === 0) throw new Error('Valid license and non-zero amount are required.'); let after = 0; await db.runTransaction(async tx => { const ref = db.collection('licenses').doc(id); const snap = await tx.get(ref); if (!snap.exists) throw new Error('License not found.'); const before = Number(snap.data()?.credits || 0); after = before + amount; if (after < 0) throw new Error('Credit balance cannot become negative.'); tx.update(ref, { credits: after, updatedAt: now() }); const tr = db.collection('creditTransactions').doc(); tx.set(tr, { userId: snap.data()?.userId || null, licenseId: id, type: 'admin_adjustment', operation: 'admin_adjustment', amount, balanceBefore: before, balanceAfter: after, reason, createdAt: now() }); }); res.json({ success: true, remainingCredits: after, message: 'Credits updated.' }); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not adjust credits.' }); }
});

app.post('/admin/license/device-limit', async (req, res) => {
  try { await requireAdmin(req); const id = String(req.body.licenseId || ''); const limit = Math.max(1, Math.floor(Number(req.body.deviceLimit || 1))); if (!id) throw new Error('License is required.'); await db.collection('licenses').doc(id).update({ deviceLimit: limit, updatedAt: now() }); res.json({ success: true, message: 'Device limit updated.' }); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not update device limit.' }); }
});

app.post('/admin/device/reset', async (req, res) => {
  try { await requireAdmin(req); const id = String(req.body.licenseId || ''); const snap = await db.collection('devices').where('licenseId', '==', id).get(); const batch = db.batch(); snap.docs.forEach(d => batch.update(d.ref, { status: 'inactive', sessionHash: null, updatedAt: now() })); await batch.commit(); res.json({ success: true, message: 'Device activations reset. Users must generate a new activation token.' }); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not reset devices.' }); }
});

app.post('/admin/package/save', async (req, res) => {
  try { await requireAdmin(req); const name = String(req.body.name || '').trim(); const credits = Math.max(1, Number(req.body.credits || 0)); const price = Math.max(0, Number(req.body.price || 0)); const currency = String(req.body.currency || 'USD').toUpperCase(); if (!name) throw new Error('Package name is required.'); const ref = db.collection('creditPackages').doc(); await ref.set({ name, credits, price, currency, active: true, sort: Date.now(), createdAt: now(), updatedAt: now() }); res.json({ success: true, message: 'Package saved.' }); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not save package.' }); }
});

app.post('/admin/payment/status', async (req, res) => {
  try { await requireAdmin(req); const paymentId = String(req.body.paymentId || ''); const status = String(req.body.status || ''); if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid payment status.'); await db.runTransaction(async tx => { const pref = db.collection('payments').doc(paymentId); const ps = await tx.get(pref); if (!ps.exists) throw new Error('Payment not found.'); const p = ps.data()!; if (p.status !== 'pending') throw new Error('Payment has already been processed.'); tx.update(pref, { status, updatedAt: now() }); if (status === 'approved') { const ls = await db.collection('licenses').where('userId', '==', p.userId).limit(1).get(); if (ls.empty) throw new Error('Customer has no linked license.'); const lr = ls.docs[0].ref; const ld = ls.docs[0].data(); const before = Number(ld.credits || 0); const amount = Number(p.credits || 0); const after = before + amount; tx.update(lr, { credits: after, updatedAt: now() }); const tr = db.collection('creditTransactions').doc(); tx.set(tr, { userId: p.userId, licenseId: lr.id, type: 'purchase', operation: 'credit_purchase', amount, balanceBefore: before, balanceAfter: after, paymentId, createdAt: now() }); } }); res.json({ success: true, message: `Payment ${status}.` }); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not update payment.' }); }
});

app.post('/admin/credit-costs', async (req, res) => {
  try { await requireAdmin(req); const pdf = Math.max(1, Math.floor(Number(req.body.pdf_processing || 2))); const generation = Math.max(1, Math.floor(Number(req.body.data_generation || 2))); await db.collection('settings').doc('creditCosts').set({ pdf_processing: pdf, data_generation: generation, updatedAt: now() }, { merge: true }); res.json({ success: true, costs: { pdf_processing: pdf, data_generation: generation } }); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message || 'Could not update credit costs.' }); }
});

export const api = onRequest({ region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' }, app);
