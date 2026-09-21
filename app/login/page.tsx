'use client';

import { FormEvent, useState } from 'react';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

function friendlyError(error: any) {
  const code = error?.code || '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/invalid-login-credentials': 'Incorrect email or password.',
    'auth/user-not-found': 'No account was found with this email.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in popup. Please allow popups and try again.',
  };
  return messages[code] || error?.message || 'Login failed.';
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function ensureProfile(user: any) {
    const ref = doc(db, 'users', user.uid);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        name: user.displayName || '',
        email: user.email || '',
        provider: user.providerData?.[0]?.providerId || 'unknown',
        emailVerified: !!user.emailVerified,
        role: 'user',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), pw);
      if (!credential.user.emailVerified) {
        router.push('/verify');
        return;
      }
      await ensureProfile(credential.user);
      router.push('/dashboard');
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      await ensureProfile(credential.user);
      router.push('/dashboard');
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError('');
    setMessage('');
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('Password reset email sent. Check your inbox.');
    } catch (e: any) {
      setError(friendlyError(e));
    }
  }

  return (
    <main className="wrap" style={{ maxWidth: 480 }}>
      <div className="card">
        <h1>Sign in</h1>
        <p className="muted">Access your Visa Autofill Pro account.</p>

        <button className="btn secondary" type="button" onClick={googleLogin} disabled={busy} style={{ width: '100%', marginBottom: 18 }}>
          {busy ? 'Please wait…' : 'Continue with Google'}
        </button>

        <div className="muted" style={{ textAlign: 'center', marginBottom: 18 }}>or sign in with email</div>

        <form onSubmit={submit}>
          <label>Email</label>
          <input className="input" value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required />
          <label>Password</label>
          <input className="input" value={pw} onChange={e => setPw(e.target.value)} type="password" autoComplete="current-password" required />
          {error && <p className="danger">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button className="btn" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <button type="button" onClick={resetPassword} className="linkButton">Forgot password?</button>
        <p className="muted" style={{ marginTop: 18 }}>Don't have an account? <Link href="/register">Create one</Link></p>
      </div>
    </main>
  );
}
