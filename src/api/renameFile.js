import moveObjectOrFolder from './moveObjectOrFolder'

/** Rename/move a file. Refuses to overwrite an existing object unless opts.overwrite. */
export default async function renameFile(s3, oldKey, newKey, bucketName, opts = {}) {
    if (!oldKey || !newKey || oldKey.endsWith('/') || newKey.endsWith('/')) throw new Error('Invalid file key')
    return moveObjectOrFolder(s3, oldKey, newKey, bucketName, opts)
}
