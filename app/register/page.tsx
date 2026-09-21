'use client';

import { FormEvent, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

function friendlyError(error: any) {
  const code = error?.code || '';
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'An account already exists with this email. Try signing in instead.',
    'auth/weak-password': 'Use a stronger password (at least 8 characters).',
    'auth/popup-closed-by-user': 'Google sign-up was cancelled.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in popup. Please allow popups and try again.',
  };
  return messages[code] || error?.message || 'Registration failed.';
}

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function createProfile(user: any) {
    await setDoc(doc(db, 'users', user.uid), {
      name: user.displayName || name,
      email: user.email || email,
      provider: user.providerData?.[0]?.providerId || 'password',
      emailVerified: !!user.emailVerified,
      role: 'user',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), pw);
      await updateProfile(credential.user, { displayName: name.trim() });
      await createProfile(credential.user);
      await sendEmailVerification(credential.user);
      router.push('/verify');
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function googleSignup() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      await createProfile(credential.user);
      router.push('/dashboard');
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap" style={{ maxWidth: 480 }}>
      <div className="card">
        <h1>Create account</h1>
        <p className="muted">Create your Visa Autofill Pro account.</p>

        <button className="btn secondary" type="button" onClick={googleSignup} disabled={busy} style={{ width: '100%', marginBottom: 18 }}>
          {busy ? 'Please wait…' : 'Continue with Google'}
        </button>

        <div className="muted" style={{ textAlign: 'center', marginBottom: 18 }}>or use email</div>

        <form onSubmit={submit}>
          <label>Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required />
          <label>Email</label>
          <input className="input" value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required />
          <label>Password</label>
          <input className="input" value={pw} onChange={e => setPw(e.target.value)} type="password" minLength={8} autoComplete="new-password" required />
          {error && <p className="danger">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button className="btn" disabled={busy} type="submit">{busy ? 'Creating…' : 'Create account'}</button>
        </form>

        <p className="muted" style={{ marginTop: 18 }}>Already have an account? <Link href="/login">Sign in</Link></p>
      </div>
    </main>
  );
}
