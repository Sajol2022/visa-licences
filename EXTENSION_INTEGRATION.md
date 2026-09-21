# Extension integration contract

Base API: `https://us-central1-visa-licences.cloudfunctions.net/api`

## First activation

1. Customer signs into the portal and clicks **Generate activation token**.
2. Portal returns a token once. It expires after 15 minutes.
3. Extension creates/persists a stable local `deviceId` for that browser profile.
4. Extension POSTs `{ token, deviceId }` to `/license/activate-token`.
5. Backend consumes the one-time token, binds the device and returns `sessionToken`.
6. Extension stores the session token locally.

## Normal operation

For each paid operation, call `/license/verify` with `{ sessionToken, deviceId }`, then `/credits/consume` with `{ sessionToken, deviceId, operation, operationId }`.

`operationId` must be unique per actual operation. Reusing the same ID is idempotent and will not deduct credits twice.

If verification or credit consumption fails, the extension must stop the paid operation and show the returned message.

## Supported operations

- `pdf_processing`
- `data_generation`

The admin can change the cost of each operation from the Admin Console.
