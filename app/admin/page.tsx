'use client';

import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../../lib/firebase';
import { useRouter } from 'next/navigation';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { callApi } from '../../lib/api';

const fmt = (v: any) => {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const money = (value: any, currency = 'USD') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
};

type Tab = 'overview' | 'licenses' | 'credits' | 'payments' | 'packages' | 'users' | 'settings';

const navItems: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '⌂' },
  { id: 'licenses', label: 'Licenses', icon: '◇' },
  { id: 'credits', label: 'Credits', icon: '◈' },
  { id: 'payments', label: 'Payments', icon: '$' },
  { id: 'packages', label: 'Packages', icon: '▦' },
  { id: 'users', label: 'Users', icon: '◎' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function Admin() {
  const router = useRouter();
  const [u, setU] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', credits: 100, deviceLimit: 1, expiresDays: 30 });
  const [creditForm, setCreditForm] = useState({ licenseId: '', amount: 10, reason: 'Manual adjustment' });
  const [pkg, setPkg] = useState({ name: '', credits: 100, price: 5, currency: 'USD' });
  const [costs, setCosts] = useState({ pdf_processing: 2, data_generation: 2 });
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');

  async function load() {
    const [us, ls, ps, cs] = await Promise.all([
      getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(100))),
      getDocs(query(collection(db, 'licenses'), orderBy('createdAt', 'desc'), limit(100))),
      getDocs(query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(100))),
      getDocs(query(collection(db, 'creditPackages'), orderBy('sort', 'asc'))),
    ]);
    setUsers(us.docs.map(d => ({ id: d.id, ...d.data() })));
    setLicenses(ls.docs.map(d => ({ id: d.id, ...d.data() })));
    setPayments(ps.docs.map(d => ({ id: d.id, ...d.data() })));
    setPackages(cs.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async x => {
      if (!x) { router.replace('/login'); return; }
      const token = await x.getIdTokenResult(true);
      if (!token.claims.admin && x.email !== 'sajolsarker5789@gmail.com') {
        setError('Admin access is not enabled for this account.');
        return;
      }
      setU(x);
      try { await load(); } catch (e: any) { setError(e.message || 'Could not load admin data.'); }
    });
  }, [router]);

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(''), 3500); }
  function fail(e: any) { setError(e?.message || 'Something went wrong.'); }

  async function bootstrap() {
    setBusy(true); setError('');
    try { const r = await callApi('/admin/bootstrap', {}); flash(r.message || 'Admin access refreshed.'); await auth.currentUser?.getIdToken(true); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function updateCosts(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await callApi('/admin/credit-costs', costs); setCosts(r.costs); flash('Credit costs updated.'); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function createLicense(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await callApi('/admin/license/create', form);
      setShowCreate(false);
      setForm({ email: '', credits: 100, deviceLimit: 1, expiresDays: 30 });
      await load();
      flash(`License ${r.license?.licenseKey || ''} created successfully.`);
    } catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function adjust(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await callApi('/admin/license/credits', creditForm); flash(r.message || 'Credits updated.'); await load(); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function toggle(l: any) {
    setBusy(true); setError('');
    try { await callApi('/admin/license/status', { licenseId: l.id, status: l.status === 'active' ? 'blocked' : 'active' }); flash(`License ${l.status === 'active' ? 'blocked' : 'activated'}.`); await load(); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function resetDevice(l: any) {
    if (!window.confirm(`Reset all active devices for ${l.licenseKey}?`)) return;
    setBusy(true); setError('');
    try { await callApi('/admin/device/reset', { licenseId: l.id }); flash('Device activations reset.'); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function changeDeviceLimit(l: any) {
    const value = window.prompt('New device limit', String(l.deviceLimit || 1));
    if (!value) return;
    const limit = Math.max(1, Math.floor(Number(value)));
    if (!Number.isFinite(limit)) return;
    setBusy(true); setError('');
    try { await callApi('/admin/license/device-limit', { licenseId: l.id, deviceLimit: limit }); flash('Device limit updated.'); await load(); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function createPackage(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await callApi('/admin/package/save', pkg); setPkg({ name: '', credits: 100, price: 5, currency: 'USD' }); flash('Credit package saved.'); await load(); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function payment(id: string, status: string) {
    setBusy(true); setError('');
    try { await callApi('/admin/payment/status', { paymentId: id, status }); flash(`Payment ${status}.`); await load(); }
    catch (e: any) { fail(e); } finally { setBusy(false); }
  }

  async function copyKey(key: string) {
    try { await navigator.clipboard.writeText(key); setCopied(key); window.setTimeout(() => setCopied(''), 1500); }
    catch { /* clipboard may be unavailable */ }
  }

  const filteredLicenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return licenses;
    return licenses.filter(l => `${l.licenseKey} ${l.userEmail} ${l.status}`.toLowerCase().includes(q));
  }, [licenses, search]);

  const stats = {
    users: users.length,
    active: licenses.filter(x => x.status === 'active').length,
    credits: licenses.reduce((a, x) => a + Number(x.credits || 0), 0),
    pending: payments.filter(x => x.status === 'pending').length,
  };

  if (!u) return <main className="adminGate"><div className="adminGateCard"><div className="brandMark">VA</div><h1>Admin Console</h1><p>{error || 'Checking admin access…'}</p>{error && <button className="btn" onClick={() => router.replace('/login')}>Return to sign in</button>}</div></main>;

  return (
    <div className="adminShell">
      <aside className={`adminSidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="adminBrand"><div className="brandMark">VA</div><div><strong>Visa Autofill Pro</strong><span>Administration</span></div></div>
        <div className="adminNavLabel">Workspace</div>
        <nav className="adminNav">
          {navItems.map(item => <button key={item.id} className={tab === item.id ? 'adminNavItem active' : 'adminNavItem'} onClick={() => { setTab(item.id); setSidebarOpen(false); }}><span className="navIcon">{item.icon}</span>{item.label}</button>)}
        </nav>
        <div className="adminSidebarBottom"><div className="securityNote"><span>●</span><div><strong>Secure mode</strong><small>Server-authorized controls</small></div></div><button className="adminSignout" onClick={() => signOut(auth)}>Sign out</button></div>
      </aside>

      <div className="adminMain">
        <header className="adminTopbar">
          <div className="adminTopLeft"><button className="mobileMenu" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button><div><span className="eyebrow">ADMINISTRATION</span><h1>{navItems.find(x => x.id === tab)?.label}</h1></div></div>
          <div className="adminTopRight"><button className="iconButton" title="Refresh" onClick={load}>↻</button><div className="adminUser"><div className="avatar">{(u.displayName || u.email || 'A').charAt(0).toUpperCase()}</div><div><strong>{u.displayName || 'Administrator'}</strong><span>{u.email}</span></div></div></div>
        </header>

        <main className="adminContent">
          {error && <div className="adminAlert error"><strong>Action needed</strong><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
          {notice && <div className="adminAlert success"><strong>Done</strong><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}

          {tab === 'overview' && <>
            <section className="adminWelcome"><div><span className="eyebrow">CONTROL CENTER</span><h2>Good to see you, {u.displayName?.split(' ')[0] || 'Admin'}.</h2><p>Manage licenses, credit balances, devices and customer access from one place.</p></div><button className="btn" onClick={() => { setTab('licenses'); setShowCreate(true); }}>+ Create license</button></section>
            <div className="adminStats">
              <Stat label="Total users" value={stats.users} detail="Registered accounts" />
              <Stat label="Active licenses" value={stats.active} detail="Currently available" />
              <Stat label="Credits in circulation" value={stats.credits.toLocaleString()} detail="Across all licenses" />
              <Stat label="Pending payments" value={stats.pending} detail="Awaiting review" />
            </div>
            <div className="adminTwoCol">
              <section className="adminCard"><div className="sectionHead"><div><h3>License activity</h3><p>Latest customer licenses</p></div><button className="textButton" onClick={() => setTab('licenses')}>View all →</button></div><div className="activityList">{licenses.slice(0, 5).map(l => <div className="activityRow" key={l.id}><div className="activityIcon">◇</div><div className="activityInfo"><strong>{l.licenseKey}</strong><span>{l.userEmail || 'Unassigned'} · {Number(l.credits || 0).toLocaleString()} credits</span></div><Status status={l.status} /></div>)}{!licenses.length && <Empty text="No licenses created yet." />}</div></section>
              <section className="adminCard"><div className="sectionHead"><div><h3>Quick controls</h3><p>Common admin actions</p></div></div><div className="quickGrid"><button onClick={() => { setTab('licenses'); setShowCreate(true); }}><span>◇</span><strong>Create license</strong><small>Assign credits & devices</small></button><button onClick={() => setTab('credits')}><span>◈</span><strong>Adjust credits</strong><small>Add or remove balance</small></button><button onClick={() => setTab('settings')}><span>⚙</span><strong>Credit costs</strong><small>Set operation pricing</small></button><button onClick={() => setTab('payments')}><span>$</span><strong>Review payments</strong><small>{stats.pending} pending requests</small></button></div></section>
            </div>
          </>}

          {tab === 'licenses' && <>
            <section className="adminPageIntro"><div><h2>License management</h2><p>Create, assign, block and control customer licenses.</p></div><button className="btn" onClick={() => setShowCreate(true)}>+ Create license</button></section>
            <section className="adminCard tableCard"><div className="tableToolbar"><div><strong>{licenses.length} licenses</strong><span>Manage customer access and device limits</span></div><div className="searchBox"><span>⌕</span><input placeholder="Search license or customer…" value={search} onChange={e => setSearch(e.target.value)} /></div></div><div className="tableWrap"><table className="adminTable"><thead><tr><th>License</th><th>Customer</th><th>Credits</th><th>Devices</th><th>Expiry</th><th>Status</th><th></th></tr></thead><tbody>{filteredLicenses.map(l => <tr key={l.id}><td><div className="licenseCell"><code>{l.licenseKey}</code><button className="copyButton" title="Copy license" onClick={() => copyKey(l.licenseKey)}>{copied === l.licenseKey ? '✓' : '⧉'}</button></div></td><td><strong>{l.userEmail || 'Unassigned'}</strong><small>{l.userId ? 'Linked account' : 'Waiting for customer'}</small></td><td><strong>{Number(l.credits || 0).toLocaleString()}</strong><small>credits</small></td><td>{l.deviceLimit || 1}<small>max devices</small></td><td>{fmt(l.expiresAt)}</td><td><Status status={l.status} /></td><td><div className="actionRow"><button onClick={() => toggle(l)}>{l.status === 'active' ? 'Block' : 'Activate'}</button><button onClick={() => resetDevice(l)}>Reset device</button><button onClick={() => changeDeviceLimit(l)}>Limit</button></div></td></tr>)}</tbody></table>{!filteredLicenses.length && <Empty text="No matching licenses." />}</div></section>
          </>}

          {tab === 'credits' && <>
            <section className="adminPageIntro"><div><h2>Credit management</h2><p>Adjust a customer's credit balance with an auditable reason.</p></div></section>
            <section className="adminCard narrowCard"><form className="adminForm" onSubmit={adjust}><Field label="License"><select value={creditForm.licenseId} onChange={e => setCreditForm({ ...creditForm, licenseId: e.target.value })} required><option value="">Select a license</option>{licenses.map(l => <option key={l.id} value={l.id}>{l.licenseKey} · {l.userEmail || 'Unassigned'} · {l.credits} credits</option>)}</select></Field><Field label="Credit adjustment"><input type="number" value={creditForm.amount} onChange={e => setCreditForm({ ...creditForm, amount: Number(e.target.value) })} required /><small>Use a positive value to add credits or a negative value to remove them.</small></Field><Field label="Reason"><input value={creditForm.reason} onChange={e => setCreditForm({ ...creditForm, reason: e.target.value })} required /></Field><div className="formActions"><button className="btn" disabled={busy}>Apply adjustment</button></div></form></section>
            <section className="adminCard tableCard"><div className="sectionHead"><div><h3>Current balances</h3><p>Quick view of all licenses</p></div></div><div className="tableWrap"><table className="adminTable"><thead><tr><th>License</th><th>Customer</th><th>Balance</th><th>Status</th></tr></thead><tbody>{licenses.map(l => <tr key={l.id}><td><code>{l.licenseKey}</code></td><td>{l.userEmail || 'Unassigned'}</td><td><strong>{Number(l.credits || 0).toLocaleString()}</strong> credits</td><td><Status status={l.status} /></td></tr>)}</tbody></table></div></section>
          </>}

          {tab === 'payments' && <><section className="adminPageIntro"><div><h2>Payment requests</h2><p>Review customer purchase requests. Payment gateways can be connected later.</p></div></section><section className="adminCard tableCard"><div className="tableWrap"><table className="adminTable"><thead><tr><th>Customer</th><th>Package</th><th>Amount</th><th>Credits</th><th>Status</th><th>Date</th><th>Action</th></tr></thead><tbody>{payments.map(p => <tr key={p.id}><td>{p.userEmail}</td><td><strong>{p.packageName}</strong></td><td>{money(p.amount, p.currency || 'USD')}</td><td>{p.credits}</td><td><Status status={p.status} /></td><td>{fmt(p.createdAt)}</td><td>{p.status === 'pending' ? <div className="actionRow"><button onClick={() => payment(p.id, 'approved')}>Approve</button><button onClick={() => payment(p.id, 'rejected')}>Reject</button></div> : <span className="muted">Processed</span>}</td></tr>)}</tbody></table>{!payments.length && <Empty text="No payment requests yet." />}</div></section></>}

          {tab === 'packages' && <><section className="adminPageIntro"><div><h2>Credit packages</h2><p>Prepare your pricing structure now. Payment collection can be connected later.</p></div></section><section className="adminCard narrowCard"><form className="adminForm" onSubmit={createPackage}><div className="formGrid2"><Field label="Package name"><input placeholder="Starter" value={pkg.name} onChange={e => setPkg({ ...pkg, name: e.target.value })} required /></Field><Field label="Credits"><input type="number" min="1" value={pkg.credits} onChange={e => setPkg({ ...pkg, credits: Number(e.target.value) })} /></Field><Field label="Price"><input type="number" step="0.01" min="0" value={pkg.price} onChange={e => setPkg({ ...pkg, price: Number(e.target.value) })} /></Field><Field label="Currency"><input value={pkg.currency} onChange={e => setPkg({ ...pkg, currency: e.target.value.toUpperCase() })} /></Field></div><div className="formActions"><button className="btn" disabled={busy}>Save package</button></div></form></section><section className="adminCard packageGrid">{packages.map(p => <div className="packageCard" key={p.id}><div className="packageTop"><span className="packageBadge">PACKAGE</span><Status status={p.active ? 'active' : 'inactive'} /></div><h3>{p.name}</h3><div className="packageCredits">{Number(p.credits || 0).toLocaleString()} <span>credits</span></div><div className="packagePrice">{money(p.price, p.currency || 'USD')}</div></div>)}{!packages.length && <Empty text="No packages created yet." />}</section></>}

          {tab === 'users' && <><section className="adminPageIntro"><div><h2>Customers</h2><p>Registered accounts connected to your portal.</p></div></section><section className="adminCard tableCard"><div className="tableWrap"><table className="adminTable"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Joined</th></tr></thead><tbody>{users.map(x => <tr key={x.id}><td><strong>{x.name || '—'}</strong></td><td>{x.email}</td><td><Status status={x.status || 'active'} /></td><td>{fmt(x.createdAt)}</td></tr>)}</tbody></table>{!users.length && <Empty text="No customers yet." />}</div></section></>}

          {tab === 'settings' && <><section className="adminPageIntro"><div><h2>System settings</h2><p>Control how many credits each extension operation consumes.</p></div></section><section className="adminCard narrowCard"><form className="adminForm" onSubmit={updateCosts}><div className="settingRow"><div><strong>PDF processing</strong><span>Credits deducted when a document is processed.</span></div><input type="number" min="1" value={costs.pdf_processing} onChange={e => setCosts({ ...costs, pdf_processing: Number(e.target.value) })} /></div><div className="settingRow"><div><strong>Data generation</strong><span>Credits deducted when data generation is requested.</span></div><input type="number" min="1" value={costs.data_generation} onChange={e => setCosts({ ...costs, data_generation: Number(e.target.value) })} /></div><div className="formActions"><button className="btn" disabled={busy}>Save settings</button></div></form></section><section className="adminCard securityPanel"><div className="securityIcon">✓</div><div><h3>Server-side enforcement</h3><p>License status, device limits and credit deductions are enforced through your backend rather than trusted only in the browser extension.</p></div></section></>}
        </main>
      </div>

      {showCreate && <div className="modalBackdrop" onMouseDown={e => { if (e.currentTarget === e.target) setShowCreate(false); }}><div className="adminModal"><div className="modalHead"><div><span className="eyebrow">NEW LICENSE</span><h2>Create customer license</h2></div><button onClick={() => setShowCreate(false)}>×</button></div><p className="modalIntro">Create a license now, then give the generated key to your customer so they can link it from their dashboard.</p><form className="adminForm" onSubmit={createLicense}><Field label="Customer email"><input type="email" placeholder="customer@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></Field><div className="formGrid3"><Field label="Starting credits"><input type="number" min="0" value={form.credits} onChange={e => setForm({ ...form, credits: Number(e.target.value) })} /></Field><Field label="Device limit"><input type="number" min="1" value={form.deviceLimit} onChange={e => setForm({ ...form, deviceLimit: Number(e.target.value) })} /></Field><Field label="Expires in days"><input type="number" min="1" value={form.expiresDays} onChange={e => setForm({ ...form, expiresDays: Number(e.target.value) })} /></Field></div><div className="licensePreview"><div className="previewIcon">◇</div><div><strong>License key generated automatically</strong><span>The key will appear in Licenses after creation.</span></div></div><div className="formActions"><button type="button" className="btn secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create license'}</button></div></form></div></div>}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="adminStat"><div className="statIcon">◈</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function Status({ status }: { status: string }) {
  const value = String(status || 'unknown').toLowerCase();
  return <span className={`status ${value}`}>{value}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Empty({ text }: { text: string }) {
  return <div className="emptyState"><div>◌</div><strong>{text}</strong><span>There is nothing to display here yet.</span></div>;
}
