import { PutObjectCommand } from '@aws-sdk/client-s3'
import headObjectExists from './headObjectExists'

/** Create an empty "folder" marker object. Refuses when a folder with that prefix already exists. */
export default async function addFolder(s3, folderPath = '', bucketName = '') {
    if (!s3) throw new Error('S3 client is not initialized')
    let key = String(folderPath).replace(/^\/+/, '')
    if (!key || key === '/') throw new Error('Folder name cannot be empty')
    if (!key.endsWith('/')) key += '/'

    if (await headObjectExists(s3, key, bucketName)) {
        const err = new Error('A folder with this name already exists')
        err.name = 'DestinationExistsError'
        throw err
    }

    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: '' }))
    return key
}
