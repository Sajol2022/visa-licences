'use client';
import { FormEvent, useEffect, useState } from 'react';
import { onAuthStateChanged, updateProfile } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
export default function ProfilePage(){
 const router=useRouter(); const [user,setUser]=useState<any>(null); const [name,setName]=useState(''); const [notice,setNotice]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
 useEffect(()=>onAuthStateChanged(auth,async u=>{if(!u){router.replace('/login');return;}setUser(u);setName(u.displayName||'');const s=await getDoc(doc(db,'users',u.uid));if(s.exists()&&!u.displayName)setName(String(s.data().name||''));}),[router]);
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');try{const value=name.trim();if(!value)throw new Error('Name is required.');if(!auth.currentUser)throw new Error('Please sign in again.');await updateProfile(auth.currentUser,{displayName:value});await updateDoc(doc(db,'users',auth.currentUser.uid),{name:value,updatedAt:serverTimestamp()});setNotice('Profile updated successfully.');}catch(e:any){setError(e.message||'Could not update profile.')}finally{setBusy(false)}}
 if(!user)return <main className="wrap">Loading…</main>;
 return <><nav className="nav"><div className="brand">Visa Autofill Pro</div><Link className="btn secondary" href="/dashboard">Back to dashboard</Link></nav><main className="wrap narrow"><div className="pageHead"><div><div className="eyebrow">Account</div><h1>Profile</h1><p className="muted">Manage your account information.</p></div></div><section className="card"><form onSubmit={save}><label>Display name</label><input className="input" value={name} onChange={e=>setName(e.target.value)} required/><label>Email</label><input className="input" value={user.email||''} readOnly/><p className="small muted">Email changes are handled by Firebase Authentication.</p>{error&&<div className="alert errorBox">{error}</div>}{notice&&<div className="alert successBox">{notice}</div>}<button className="btn" disabled={busy}>{busy?'Saving…':'Save changes'}</button></form></section></main></>;
}
