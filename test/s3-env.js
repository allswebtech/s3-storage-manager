// Connection settings of the local S3-compatible test server (see scripts/s3-server.sh and CI).
import { CreateBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import createS3Client from '../src/api/s3Client.js'

export const S3_ENV = {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:7070',
    region: process.env.S3_REGION || 'us-east-1',
    access_key: process.env.S3_ACCESS_KEY || 'testaccesskey',
    secret_key: process.env.S3_SECRET_KEY || 'testsecretkey123',
}

export function testClient() {
    return createS3Client(S3_ENV)
}

let counter = 0
export function uniqueBucketName(tag = 't') {
    counter += 1
    return `${tag}-${Date.now().toString(36)}-${process.pid.toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`.toLowerCase().slice(0, 63)
}

/** Create a fresh bucket. With `cors`, apply the CORS rule the configuration page recommends. */
export async function createBucket(s3, name, { cors = null, objectLock = false } = {}) {
    await s3.send(new CreateBucketCommand({ Bucket: name, ...(objectLock && { ObjectLockEnabledForBucket: true }) }))
    if (cors) {
        await s3.send(new PutBucketCorsCommand({
            Bucket: name,
            CORSConfiguration: {
                CORSRules: [{
                    AllowedHeaders: ['*'],
                    AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                    AllowedOrigins: Array.isArray(cors) ? cors : [cors],
                    ExposeHeaders: ['ETag'],
                    MaxAgeSeconds: 3000,
                }],
            },
        }))
    }
    return name
}
