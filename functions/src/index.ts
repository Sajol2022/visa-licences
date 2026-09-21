import {onRequest} from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

admin.initializeApp();
const db = admin.firestore();
const app = express();
app.use(cors({origin:true}));
app.use(express.json({limit:'256kb'}));

function hash(value:string){return crypto.createHash('sha256').update(value).digest('hex');}
function token(){return crypto.randomBytes(32).toString('hex');}
function now(){return admin.firestore.FieldValue.serverTimestamp();}
function validDate(v:any){return !v || new Date(v).getTime() > Date.now();}

async function loadLicense(key:string){
  const snap=await db.collection('licenses').where('licenseKey','==',key).limit(1).get();
  if(snap.empty) return null;
  return {ref:snap.docs[0].ref,data:snap.docs[0].data()};
}

async function authorize(body:any){
  const key=String(body.licenseKey||'').trim();
  const deviceId=String(body.deviceId||'').trim();
  if(!key||!deviceId) throw new Error('License key and device ID are required.');
  const found=await loadLicense(key);
  if(!found) throw new Error('Invalid license.');
  const d=found.data;
  if(d.status!=='active') throw new Error(`License is ${d.status}.`);
  if(!validDate(d.expiresAt)) throw new Error('License has expired.');
  const sessionHash=body.sessionToken?hash(String(body.sessionToken)):'';
  const deviceRef=db.collection('devices').doc(`${found.ref.id}_${hash(deviceId).slice(0,24)}`);
  const deviceSnap=await deviceRef.get();
  const devices=await db.collection('devices').where('licenseId','==',found.ref.id).where('status','==','active').get();
  if(!deviceSnap.exists && devices.size >= Number(d.deviceLimit||1)) throw new Error('Device limit reached.');
  if(deviceSnap.exists && deviceSnap.data()?.status!=='active') throw new Error('Device is inactive.');
  const sessionToken=body.sessionToken || token();
  await deviceRef.set({userId:d.userId||null,licenseId:found.ref.id,deviceHash:hash(deviceId),status:'active',sessionHash:hash(sessionToken),lastSeenAt:now(),createdAt:deviceSnap.exists?deviceSnap.data()?.createdAt:now()},{merge:true});
  return {found,deviceRef,sessionToken};
}

app.post('/license/activate',async(req,res)=>{try{const r=await authorize(req.body);const d=r.found.data;res.json({success:true,sessionToken:r.sessionToken,license:{status:d.status,credits:Number(d.credits||0),expiresAt:d.expiresAt||null,deviceLimit:Number(d.deviceLimit||1)}});}catch(e:any){res.status(400).json({success:false,message:e.message||'Activation failed.'});}});
app.post('/license/verify',async(req,res)=>{try{const r=await authorize(req.body);const d=r.found.data;res.json({success:true,sessionToken:r.sessionToken,license:{status:d.status,credits:Number(d.credits||0),expiresAt:d.expiresAt||null,deviceLimit:Number(d.deviceLimit||1)}});}catch(e:any){res.status(401).json({success:false,message:e.message||'Verification failed.'});}});

app.post('/credits/consume',async(req,res)=>{try{
  const r=await authorize(req.body); const d=r.found.data; const operation=String(req.body.operation||'pdf_processing'); const operationId=String(req.body.operationId||'');
  if(!operationId) throw new Error('Operation ID is required.');
  const existing=await db.collection('creditTransactions').where('operationId','==',operationId).limit(1).get();
  if(!existing.empty){const x=existing.docs[0].data();return res.json({success:true,remainingCredits:Number(x.balanceAfter||0),duplicate:true});}
  const settingRef=db.collection('settings').doc('creditCosts'); const setting=await settingRef.get();
  const cost=Number(setting.data()?.[operation] ?? 2); if(!Number.isFinite(cost)||cost<=0) throw new Error('Invalid credit configuration.');
  let remaining=0;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(r.found.ref); const current=Number(snap.data()?.credits||0); if(current<cost) throw new Error(`Insufficient credits. Required: ${cost}.`); remaining=current-cost;
    tx.update(r.found.ref,{credits:remaining,updatedAt:now()});
    const tr=db.collection('creditTransactions').doc(); tx.set(tr,{userId:snap.data()?.userId||null,licenseId:r.found.ref.id,type:'usage',operation,operationId,amount:-cost,balanceBefore:current,balanceAfter:remaining,createdAt:now()});
  });
  res.json({success:true,remainingCredits:remaining,cost});
}catch(e:any){res.status(400).json({success:false,message:e.message||'Credit operation failed.'});}});

export const api=onRequest({region:'us-central1',timeoutSeconds:30,memory:'256MiB'},app);
