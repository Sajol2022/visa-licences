// Run this only from a trusted environment with Firebase Admin credentials.
// Usage pattern: setCustomUserClaims(uid, {admin:true})
import * as admin from 'firebase-admin';
admin.initializeApp();
const uid = process.argv[2];
if (!uid) throw new Error('Usage: ts-node set-admin.ts FIREBASE_UID');
admin.auth().setCustomUserClaims(uid, {admin:true}).then(()=>{console.log(`Admin claim set for ${uid}`);process.exit(0);});
