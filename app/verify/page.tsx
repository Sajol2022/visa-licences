'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, reload, sendEmailVerification, signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useRouter } from 'next/navigation';

export default function VerifyPage() {
  const [user, setUser] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function checkVerification() {
    if (!auth.currentUser) return;
    setError('');
    setMessage('Checking…');
    await reload(auth.currentUser);
    if (auth.currentUser.emailVerified) {
      router.replace('/dashboard');
    } else {
      setMessage('Your email is not verified yet. Open the verification email and then click this button again.');
    }
  }

  async function resend() {
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
      setError('');
      setMessage('Verification email sent again. Check your inbox and spam folder.');
    } catch (e: any) {
      setError(e.message || 'Could not send verification email.');
    }
  }

  if (!user) return <main className="wrap">Loading…</main>;

  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="card">
        <h1>Verify your email</h1>
        <p className="muted">We sent a verification email to <strong>{user.email}</strong>. Verify it before using your account.</p>
        {error && <p className="danger">{error}</p>}
        {message && <p className="success">{message}</p>}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn" onClick={checkVerification}>I verified my email</button>
          <button className="btn secondary" onClick={resend}>Resend email</button>
        </div>
        <button className="linkButton" onClick={() => signOut(auth).then(() => router.replace('/login'))}>Sign out</button>
      </div>
    </main>
  );
}
