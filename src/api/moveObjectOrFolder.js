import copyObjectOrFolder from './copyObjectOrFolder'
import deleteFileOrFolder from './deleteFileOrFolder'
import headObjectExists from './headObjectExists'

export class DestinationExistsError extends Error {
    constructor(key) {
        super(`"${key}" already exists`)
        this.name = 'DestinationExistsError'
        this.key = key
    }
}

/**
 * Move = copy, then delete the source. The delete only runs after every copy succeeded.
 * Unless `overwrite` is true an existing destination is refused with DestinationExistsError.
 * When the copy succeeded but deleting the source failed, the error says so (both copies exist).
 */
export default async function moveObjectOrFolder(s3, src, dst, bucketName, { overwrite = false } = {}) {
    if (!s3) throw new Error('S3 client is not initialized')
    if (!src || !dst) throw new Error('Source and destination are required')
    if (src.endsWith('/') !== dst.endsWith('/')) throw new Error('Cannot move a file onto a folder or a folder onto a file')
    if (src === dst) return 0
    if (src.endsWith('/') && dst.startsWith(src)) throw new Error('Destination cannot be inside the source folder')

    if (!overwrite && await headObjectExists(s3, dst, bucketName)) throw new DestinationExistsError(dst)

    const copied = await copyObjectOrFolder(s3, src, dst, bucketName)
    try {
        await deleteFileOrFolder(s3, src, bucketName)
    } catch (err) {
        const e = new Error(`Copied to "${dst}", but the original could not be removed: ${err.message}`)
        e.name = 'MoveCleanupError'
        e.cause = err
        throw e
    }
    return copied
}
