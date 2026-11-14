import moveObjectOrFolder from './moveObjectOrFolder'

/** Rename/move a folder (all objects under the prefix). Refuses to merge into an existing folder. */
export default async function renameFolder(s3, oldPrefix, newPrefix, bucketName, opts = {}) {
    if (!oldPrefix || !newPrefix) throw new Error('Invalid folder')
    const normOld = oldPrefix.endsWith('/') ? oldPrefix : `${oldPrefix}/`
    const normNew = newPrefix.endsWith('/') ? newPrefix : `${newPrefix}/`
    return moveObjectOrFolder(s3, normOld, normNew, bucketName, opts)
}
