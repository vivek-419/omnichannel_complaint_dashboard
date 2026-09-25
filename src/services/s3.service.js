const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class S3Service {
  constructor() {
    this.bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || '';
    this.region = process.env.AWS_REGION || 'ap-south-1';
    this.accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    this.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';

    this.isConfigured = Boolean(this.bucket && this.accessKeyId && this.secretAccessKey);

    if (this.isConfigured) {
      this.client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey
        }
      });
      console.log(`[AWS S3] Initialized client for bucket: "${this.bucket}" (Region: ${this.region})`);
    } else {
      this.client = null;
    }
  }

  getStatus() {
    return {
      configured: this.isConfigured,
      bucket: this.bucket || null,
      region: this.region,
      hasCredentials: Boolean(this.accessKeyId && this.secretAccessKey)
    };
  }

  async uploadAttachment({ ticketId, fileName, contentType, fileBuffer }) {
    if (!this.isConfigured || !this.client) {
      return {
        success: false,
        error: 'AWS S3 is not configured with valid credentials.'
      };
    }

    const key = `complaints/${ticketId || 'general'}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType || 'application/octet-stream'
      });

      await this.client.send(command);

      // Generate a 24-hour pre-signed download URL
      const getCommand = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const downloadUrl = await getSignedUrl(this.client, getCommand, { expiresIn: 86400 });

      return {
        success: true,
        key,
        bucket: this.bucket,
        downloadUrl
      };
    } catch (err) {
      console.error('[AWS S3] Upload failed:', err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  async listTicketAttachments(ticketId) {
    if (!this.isConfigured || !this.client) {
      return [];
    }

    try {
      const prefix = `complaints/${ticketId}/`;
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix
      });

      const response = await this.client.send(command);
      if (!response.Contents) return [];

      return response.Contents.map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified
      }));
    } catch (err) {
      console.error('[AWS S3] List attachments error:', err.message);
      return [];
    }
  }
}

module.exports = new S3Service();
