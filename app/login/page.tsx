'use client';
import {FormEvent,useState} from 'react';
import {signInWithEmailAndPassword} from 'firebase/auth';
import {auth} from '../../lib/firebase';
import {useRouter} from 'next/navigation';
export default function Login(){const [email,setEmail]=useState('');const[pw,setPw]=useState('');const[error,setError]=useState('');const r=useRouter();async function submit(e:FormEvent){e.preventDefault();setError('');try{await signInWithEmailAndPassword(auth,email,pw);r.push('/dashboard')}catch(e:any){setError(e.message||'Login failed')}}return <main className="wrap" style={{maxWidth:480}}><div className="card"><h1>Sign in</h1><form onSubmit={submit}><label>Email</label><input className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required/><label>Password</label><input className="input" value={pw} onChange={e=>setPw(e.target.value)} type="password" required/>{error&&<p className="danger">{error}</p>}<button className="btn">Sign in</button></form></div></main>}
