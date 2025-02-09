import { Injectable } from '@nestjs/common';
import * as AWS from 'aws-sdk';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StorageService {
  private s3: AWS.S3;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.s3 = new AWS.S3({
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      region: this.configService.get<string>('AWS_REGION'),
    });
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET') ?? '';
  }

  async uploadToS3(base64Data: string, fileName: string): Promise<string> {
    const buffer = Buffer.from(base64Data, 'base64');

    const params: AWS.S3.PutObjectRequest = {
      Bucket: this.bucketName,
      Key: `predictions/${fileName}`,
      Body: buffer,
      ContentType: 'image/png',
      ACL: 'public-read',
    };

    const result = await this.s3.upload(params).promise();
    return result.Location;
  }
}
