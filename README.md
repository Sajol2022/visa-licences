# Visa Autofill Pro — License & Credit Portal

This project contains a Next.js customer/admin portal and Firebase Cloud Functions API for the Visa Autofill Pro Chrome extension.

## Important
- This is the commercial management layer; it does not replace the extension's existing PDF/OCR/autofill features.
- Set `API_BASE_URL` in the extension's `config.js` to the deployed Firebase Function URL.
- Configure Firebase Authentication and Firestore before production use.
- Create an initial admin by setting a Firebase custom claim (`admin: true`) using a secure server-side script. Never expose Admin SDK credentials to the browser.
- Payment provider integration is intentionally provider-neutral. Add a verified server-side webhook that creates a `payments` record and then atomically increments the license's credits.

## Deploy
1. Copy `.env.example` to `.env.local` and fill Firebase web config.
2. `npm install && npm run build`.
3. Deploy the Next.js app to Vercel and add the same environment variables in Vercel.
4. In `functions`, install dependencies and run `npm run build`, then `firebase deploy --only functions`.
5. Put the resulting function URL into the extension `config.js`.
6. Repackage the extension after configuration.

## Firestore model
`users`, `licenses`, `devices`, `creditTransactions`, `payments`, `creditPackages`, `settings`, `auditLogs`.

The included API already implements license activation/verification, device limits, atomic credit consumption, duplicate operation protection, and server-side status checks. Payment and admin management endpoints should be added behind Firebase Auth/custom claims before accepting real money.
