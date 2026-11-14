import { ListBucketsCommand } from '@aws-sdk/client-s3'
import { S3_ENV, testClient } from '../s3-env.js'

// Fail loudly (never skip) when the S3 server is not reachable: a skipped suite is a false green.
export default async function setup() {
    const s3 = testClient()
    try {
        await s3.send(new ListBucketsCommand({}))
    } catch (err) {
        throw new Error(`S3 test server not reachable at ${S3_ENV.endpoint} (${err.name}: ${err.message}). Start it with: npm run s3:start`, { cause: err })
    } finally {
        s3.destroy()
    }
}
