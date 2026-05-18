import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

function getClient(): S3Client {
  return new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT!,
    region: 'auto',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY!,
      secretAccessKey: process.env.STORAGE_SECRET_KEY!
    },
    forcePathStyle: true
  })
}

export async function uploadBuffer(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const client = getClient()

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  )

  return `${process.env.STORAGE_PUBLIC_URL}/${key}`
}
