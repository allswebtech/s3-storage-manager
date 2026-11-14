# Contributing

Bug reports and pull requests are welcome.

## Reporting a bug

Open an issue with the app version, your browser, the storage provider and the steps to
reproduce. Add the error lines from the browser console. Remove access keys, secret keys
and signed URLs before you post anything.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Install and start:

   ```bash
   npm ci
   npm run dev
   ```

3. Add or update a test for what you change. Run everything before you open a pull
   request (Docker is needed for the S3 test server):

   ```bash
   npm run lint
   npm run s3:start
   npm test
   npm run test:e2e
   npm run s3:stop
   ```

4. If you change the Content-Security-Policy or another header, edit
   `config/security-headers.js` and run `npm run headers`. It regenerates `vercel.json`
   and `public/.htaccess`.
5. Describe the change under a new heading in `CHANGELOG.md`.
6. Open a pull request. GitHub Actions runs the jobs `lint`, `build`, `test` and `e2e`.

## Guidelines

- Keys can contain any character. Build and compare them with the helpers in
  `src/helpers/keys.js`; do not use `String.replace` or `encodeURI` on keys.
- An operation that can destroy data (overwrite, delete, move) must report failures to
  the user and must have a test.
- The app has no server and must keep working as static files.
- Stored credentials must stay readable by newer versions.

By contributing you agree that your contribution is licensed under the MIT license.
