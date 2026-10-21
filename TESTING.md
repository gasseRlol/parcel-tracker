# Testing on this computer

Everything here runs against Firebase's local emulators, so no real accounts or deliveries are created.

1. Start the emulators (needs Java; one is unzipped in `%USERPROFILE%\.local\jre21`):

   ```bash
   PATH="$HOME/.local/jre21/jdk-21.0.12.1+1-jre/bin:$PATH" firebase emulators:start --only auth,firestore
   ```

2. Start the app: `node server.js`
3. Open the customer side at http://localhost:3100/?emu and the courier side at http://127.0.0.1:3100/?emu.
   They are different addresses on purpose, so each keeps its own sign-in.

## Emulator-only test accounts

These exist only inside the local emulators and are wiped when they stop.

| Role | Email | Password |
|---|---|---|
| Customer | customer@test.local | orbit-test-4821 |
| Courier | courier@test.local | orbit-test-4821 |
