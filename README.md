# Visa Autofill Pro — Commercial Portal

Production-oriented customer/admin portal for a credit-based browser extension.

## Current flow

1. Customer signs in with Google or Email/Password.
2. Email/password accounts use Firebase email verification.
3. Customer links a license key.
4. Customer generates a short-lived, one-time extension activation token.
5. Extension exchanges that token for a device-bound session token.
6. Server verifies the session token, license status, expiry and device before every paid operation.
7. Credits are deducted atomically on the server using an operationId for idempotency.
8. Admin controls license status, credits, device limits, packages, payments and credit costs.
9. Payment gateway is intentionally not hard-wired yet; payment requests can be approved manually until a gateway is added.

## Local setup

Create `.env.local` from `.env.example`, then run:

```bash
npm install
npm run dev
```

## Firebase Functions

The `functions` folder is a separate Firebase backend. Deploy it with the Firebase CLI (global install is optional):

```bash
npx firebase-tools@latest login
npx firebase-tools@latest use visa-licences
cd functions
npm install
npm run build
cd ..
npx firebase-tools@latest deploy --only functions
```

Set `NEXT_PUBLIC_FUNCTIONS_BASE_URL` to the deployed API URL if it differs from the default.

## Admin bootstrap

The configured owner email in the backend (`ADMIN_EMAILS`, defaulting to `sajolsarker5789@gmail.com`) can sign in and use the Admin Console's **Refresh admin access** button once the Functions API is deployed. The backend sets a Firebase custom claim `admin: true`. Sign out/in afterwards so the browser receives the new claim.

For production, set `ADMIN_EMAILS` as a Functions environment variable instead of relying on the default.

## Security notes

- Firestore client writes for licenses, credits, payments, devices, transactions and activation tokens are denied.
- Credit deductions happen only in Cloud Functions and use Firestore transactions.
- Activation tokens are stored only as SHA-256 hashes and expire after 15 minutes.
- The session token is stored only as a hash on the device record.
- Never commit `.env.local`, service-account JSON, private keys or payment secrets.
- Before launch, add Firebase App Check, rate limiting/abuse protection, monitoring and a real payment provider.
