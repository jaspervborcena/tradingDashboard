# Signal Monitor Frontend

This is the Angular frontend for the read-only trading scanner dashboard. See the [root README](../README.md) for the phased roadmap, Firebase setup, security rules, and current Firestore data-contract assumptions.

## Run locally

The `jasperpos-dev` Firebase web app config is included in `src/environments/environment.ts`. Enable Email/Password in Firebase Authentication, then create an account from the sign-in screen. Then run:

```sh
npm install
npm start
```

The development server is available at `http://localhost:4200/`.

## Validate

```sh
npm run build
npx ng test --watch=false
```

Client access is read-only. No service-account credentials belong in this project.
