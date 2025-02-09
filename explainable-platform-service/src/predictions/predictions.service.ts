import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord } from '../entity/prediction-record.entity';
import { parseCsv } from '../utils/csv-parser.util';
import { QueueService } from '../queue/queue.service';
import { Multer } from 'multer';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PredictionsService {
  constructor(
    @InjectRepository(Prediction)
    private predictionsRepository: Repository<Prediction>,
    @InjectRepository(PredictionRecord)
    private recordsRepository: Repository<PredictionRecord>,
    private readonly queueService: QueueService,
  ) {}

  async createPrediction(file: Multer.File, modelName: string) {
    const jsonData = await parseCsv(file.buffer.toString());

    const predictionId = uuidv4();
    const prediction = this.predictionsRepository.create({
      id: predictionId,
      modelName,
      dfColumns: jsonData[0],
    });
    await this.predictionsRepository.save(prediction);

    for (const row of jsonData) {
      const recordId = uuidv4();
      const record = this.recordsRepository.create({
        id: recordId,
        prediction,
        dfData: row,
      });
      await this.recordsRepository.save(record);
    }

    await this.queueService.addPredictionJob(prediction.id);

    return { message: 'Prediction Created', predictionId: prediction.id };
  }

  async getPredictions() {
    return this.predictionsRepository.find({
      select: ['id', 'modelName', 'heatmap', 'beeswarm'],
    });
  }

  async getPredictionRecords(
    predictionId: string,
    page: number,
    limit: number,
  ) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction)
      throw new NotFoundException(`Prediction ID ${predictionId} not found`);

    const [records, total] = await this.recordsRepository.findAndCount({
      where: { prediction: { id: predictionId } },
      select: ['id', 'proba', 'class', 'waterfall'],
      take: limit,
      skip: (page - 1) * limit,
    });

    return {
      totalRecords: total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: records,
    };
  }
}
