# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-11-14

### Changed

- The bucket name in the file list has a storage icon instead of a wastebasket emoji,
  which looked like a delete button.
- Image previews are centred in the preview window.
- Button labels no longer break onto two lines.
- The conflict notice uses correct singular and plural wording.
- New README with new screenshots. `npm run screenshots` regenerates them.

### Fixed

- The "On conflict" label in the move/copy dialog overlapped its selector.

## [1.1.0] - 2026-11-14

A stability and security release. Saved credentials from 1.0 keep working.

### Fixed

- **Preview could overwrite a file with wrong content.** "Save" was offered when a file
  was too large to load or had failed to load, and content from the previously opened
  file could be saved into the next one. Save is now available only after the file loaded
  and was changed, and the file's content type and metadata are kept.
- **Rename and move silently overwrote** an existing file or folder with the same name.
  They now refuse; copy and move ask whether to skip, replace or keep both.
- **Empty files could not be uploaded.**
- Multipart uploads sent their parts in the wrong order, which some providers reject.
- Cancelling an upload did not stop the parts already in flight, and one failed part did
  not stop the others.
- Copy, rename and move failed, or created wrong keys, for names containing `$`, `?`,
  `#`, `+`, `&` or `%`.
- A delete that partly failed was reported as successful. Failed items are now listed.
- Search and the type filter returned nothing inside a sub-folder.
- The folder details window kept reloading its totals while open.
- The browser Back button left the app instead of going to the previous folder.
- A listing error (no permission, CORS, network) looked like an empty folder. It now
  shows the error with a Retry button.
- Fast navigation could show the listing of a previously opened folder.
- After switching to another bucket the app opened a folder of the previous bucket.
- Downloaded files with non-ASCII names got percent-encoded names.
- The upload queue could start twice; conflict detection used an outdated listing.
- Copy and move could not target the bucket root, and the list did not refresh after a
  copy.
- A failed connection test cleared the credential form.
- The lint configuration did not load.

### Changed

- Folder navigation is part of the address (`?path=`), so Back, Forward, reload and
  shared links work.
- Each bucket remembers its own last folder.
- A credential is tested before it is saved; a newly added credential becomes the active
  one.
- "Disconnect" asks for confirmation.
- JSON files open as editable text.
- ZIP downloads read objects through the S3 API instead of public links, are limited to
  1 GiB, and use paths relative to the current folder.
- The suggested CORS rule uses the app's own address instead of `*`.
- Uploads no longer send the optional CRC32 checksums that several S3-compatible
  providers reject.
- The JavaScript bundle is split into smaller parts; the ZIP library and the settings
  pages load on demand.
- Dependencies updated: Vite 8, ESLint 10, lucide-react 1, and the latest React 19,
  React Router 7, Tailwind CSS 4 and AWS SDK v3 releases. Node.js 22.13 or later is
  required to build.

### Added

- Content-Security-Policy in the production build, and security headers for Vercel
  (`vercel.json`) and Apache/LiteSpeed (`.htaccess`).
- Support for serving the app under a sub-path (`VITE_BASE_PATH`) and a GitHub Pages
  deployment workflow.
- Name validation for new folders and renames.
- Unit tests, integration tests against a real S3-compatible server, end-to-end tests,
  and a GitHub Actions workflow that runs them.
- `package-lock.json` is now part of the repository.

### Security

- Links opened in a new tab can no longer control the app's tab (`noopener`).
- Endpoint and public URL values must be `http` or `https` addresses.

### Removed

- The unused `axios` dependency and unused image assets.

## [1.0.0] - 2025-12-12

First public version: browse, upload (multipart), rename, move, copy, delete, search,
preview, ZIP download and several saved credentials.

[1.1.1]: https://github.com/allswebtech/s3-storage-manager/releases/tag/v1.1.1
[1.1.0]: https://github.com/allswebtech/s3-storage-manager/releases/tag/v1.1.0
