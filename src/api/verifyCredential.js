import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import createS3Client from './s3Client'

/** Check that the credential can list the bucket. Throws the SDK error when it cannot. */
export default async function verifyCredential(cred) {
    const client = createS3Client(cred)
    try {
        await client.send(new ListObjectsV2Command({ Bucket: cred.name, MaxKeys: 1, Delimiter: '/' }))
        return true
    } finally {
        try { client.destroy() } catch { /* ignore */ }
    }
}
