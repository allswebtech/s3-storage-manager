# Security policy

## Supported versions

Security fixes are made on the latest release.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub:
**[Report a vulnerability](https://github.com/allswebtech/s3-storage-manager/security/advisories/new)**
(Security tab → Advisories → Report a vulnerability).

Include the version or commit, your browser, the storage provider, and the steps to
reproduce. Remove access keys, secret keys and signed URLs from anything you send.

You will get a first answer within 5 working days. Once a fix is released, the advisory
is published and you are credited, unless you prefer not to be named.

## How the app handles your keys

S3 Storage Manager has no server. It runs entirely in your browser:

- Access keys are saved in the browser's `localStorage` for the site you opened the app
  on, and are used there to sign requests. They are sent only to the storage endpoint you
  configured.
- Anyone who can use your browser profile, or run script on the same origin, can read
  them. Host the app on an origin you control and do not share that origin with other
  apps.
- Use a dedicated access key that is limited to the buckets and actions you need, and
  rotate it regularly. Do not use an account root key.
- Restrict the bucket's CORS `AllowedOrigins` to the address you serve the app from.
- "Remove" a credential in the app when you are done on a shared computer.
